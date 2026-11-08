// Cooking plan email reminders. Paste into a Google Apps Script project; see README.md.
// Script Properties required: EMAIL_TO, PLAN_URL.

const WEEKS_PER_MONTH = 4;
const DAY_MS = 86400000;
const CACHE_SECONDS = 3600;
const LATE_HOURS = 1; // An hourly trigger can land late; still send in the following hour.
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SENT_PREFIX = 'sent:';

// ---- Entry points ----

function sendDueReminders() {
  const props = PropertiesService.getScriptProperties();
  const plan = loadPlan_();
  const now = localNow_(plan.timezone);

  dueReminders_(plan, now).forEach((reminder) => {
    const key = SENT_PREFIX + reminder.key;
    if (props.getProperty(key)) return;
    send_(reminder.email);
    props.setProperty(key, new Date().toISOString());
  });
}

function setup() {
  const props = PropertiesService.getScriptProperties();
  ['EMAIL_TO', 'PLAN_URL'].forEach((name) => {
    if (!props.getProperty(name)) throw new Error('Set the ' + name + ' script property first.');
  });

  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === 'sendDueReminders')
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('sendDueReminders').timeBased().everyHours(1).create();
}

function sendTestEmail() {
  const plan = loadPlan_();
  send_(cookDayEmail_(plan, weekInfo_(plan, 1)));
}

// ---- Schedule ----

function dueReminders_(plan, now) {
  const due = [];
  const add = (hour, weekSunday, id, build) => {
    if (now.hour >= hour && now.hour <= hour + LATE_HOURS) {
      due.push({ key: toIso_(weekSunday) + '-' + id, email: build() });
    }
  };

  const thisWeek = weekInfo_(plan, weekNumber_(plan, now.day));
  const dow = dayOfWeek_(now.day);
  const detail = thisWeek.detail;

  if (dow === 6) {
    // Saturday looks ahead, so it also covers the day before Week 1.
    const nextWeek = weekInfo_(plan, thisWeek.n + 1);
    if (nextWeek.detail) add(18, nextWeek.sunday, 'sat-shop', () => shopEmail_(plan, nextWeek));
  }

  if (thisWeek.n < 1) return due;

  if (dow === 0) {
    if ((thisWeek.n - 1) % WEEKS_PER_MONTH === 0 && thisWeek.month) {
      add(7, thisWeek.sunday, 'month-start', () => monthEmail_(plan, thisWeek));
    }
    if (detail) add(8, thisWeek.sunday, 'sun-cook', () => cookDayEmail_(plan, thisWeek));
  }

  if (detail && detail.midweek && DAY_NAMES[dow] === detail.midweek.day) {
    add(7, thisWeek.sunday, 'midweek', () => midweekEmail_(thisWeek));
  }
  if (detail && dow === 3) {
    add(20, thisWeek.sunday, 'wed-move', () => moveEmail_('Thu–Fri'));
  }
  if (detail && dow === 5) {
    add(20, thisWeek.sunday, 'fri-move', () => moveEmail_('Sat–Sun'));
  }

  return due;
}

// ---- Dates (whole days since the epoch, in the plan's time zone) ----

function localNow_(timezone) {
  const date = new Date();
  return {
    day: toDay_(Utilities.formatDate(date, timezone, 'yyyy-MM-dd')),
    hour: Number(Utilities.formatDate(date, timezone, 'H')),
  };
}

function toDay_(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

function toIso_(day) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function dayOfWeek_(day) {
  return new Date(day * DAY_MS).getUTCDay();
}

function weekNumber_(plan, day) {
  return Math.floor((day - toDay_(plan.startDate)) / 7) + 1;
}

function weekInfo_(plan, n) {
  const monthNo = Math.ceil(n / WEEKS_PER_MONTH);
  const month = plan.months.find((m) => m.month === monthNo) || null;
  const detailed = month && month.status === 'detailed';
  return {
    n,
    monthNo,
    month,
    detail: (detailed && month.weeks[(n - 1) % WEEKS_PER_MONTH]) || null,
    sunday: toDay_(plan.startDate) + (n - 1) * 7,
  };
}

// ---- Plan ----

function loadPlan_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('plan');
  if (cached) return JSON.parse(cached);

  const url = PropertiesService.getScriptProperties().getProperty('PLAN_URL');
  const json = UrlFetchApp.fetch(url).getContentText();
  try {
    cache.put('plan', json, CACHE_SECONDS);
  } catch (err) {
    console.warn('Plan not cached: ' + err);
  }
  return JSON.parse(json);
}

function shoppingItems_(plan, week) {
  const pantry = week.includesPantry ? plan.pantry.map((item) => 'Pantry: ' + item) : [];
  return week.costcoList.concat(pantry);
}

// ---- Email bodies ----

function shopEmail_(plan, info) {
  const week = info.detail;
  const tonight = week.saturdayNight || [];
  return {
    subject: '[Cooking] Tomorrow: Week ' + info.n + ' shop + cook',
    sections: [
      { heading: (week.store || 'Costco') + ' list', style: 'check', lines: shoppingItems_(plan, week) },
      tonight.length
        ? { heading: 'Tonight', style: 'bullet', lines: tonight }
        : { heading: 'Tonight', lines: ['Nothing to thaw or prep tonight.'] },
    ],
  };
}

function cookDayEmail_(plan, info) {
  const week = info.detail;
  return {
    subject: '[Cooking] Cook day: Week ' + info.n + ' menu',
    sections: [
      { heading: week.title, lines: [week.skill] },
      {
        heading: 'Menu',
        header: ['Component', 'Make', 'Done when'],
        rows: week.components.map((c) => [c.role, c.make, c.doneWhen || '—']),
      },
      { heading: 'Sunday order of operations', style: 'number', lines: plan.sundayOrderOfOperations },
      { heading: 'The 7-day rule', lines: [plan.sevenDayRule] },
    ],
  };
}

function midweekEmail_(info) {
  const midweek = info.detail.midweek;
  const sections = [{ heading: midweek.title, lines: [midweek.task] }];
  if (midweek.buyFresh) sections.push({ heading: 'Buy fresh today', lines: [midweek.buyFresh] });
  return { subject: '[Cooking] Tonight: ' + (midweek.title || midweek.task), sections };
}

function moveEmail_(meals) {
  return {
    subject: '[Cooking] Move ' + meals + ' meals to the fridge',
    sections: [{ lines: ['Move the ' + meals + ' meals from the freezer to the fridge tonight.'] }],
  };
}

function monthEmail_(plan, info) {
  const month = info.month;
  const goals = month.goals || month.weeks.map((week) => week.skill);
  const sections = [{ heading: 'Goals', style: 'bullet', lines: goals }];
  if (month.status === 'outline') {
    sections.push({ heading: 'Candidate dishes', style: 'bullet', lines: month.candidateDishes });
    sections.push({
      heading: 'Needs planning',
      lines: ['Month ' + month.month + ' is not planned in detail yet. Only this monthly email goes out '
        + 'until its weeks are added to plan.json.'],
    });
  }
  return { subject: '[Cooking] Month ' + month.month + ' starts: ' + month.theme, sections };
}

// ---- Email rendering ----

function send_(email) {
  const props = PropertiesService.getScriptProperties();
  const siteUrl = props.getProperty('PLAN_URL').replace(/plan\.json(\?.*)?$/, '');
  MailApp.sendEmail({
    to: props.getProperty('EMAIL_TO'),
    subject: email.subject,
    body: renderText_(email.sections, siteUrl),
    htmlBody: renderHtml_(email.sections, siteUrl),
  });
}

function renderText_(sections, siteUrl) {
  const blocks = sections.map((section) => {
    const out = section.heading ? [section.heading.toUpperCase()] : [];
    if (section.rows) {
      section.rows.forEach(([role, make, doneWhen]) => {
        out.push(role + ': ' + make + (doneWhen === '—' ? '' : ' Done when: ' + doneWhen + '.'));
      });
    } else {
      const marker = { check: () => '[ ] ', bullet: () => '- ', number: (i) => (i + 1) + '. ' }[section.style];
      section.lines.forEach((line, i) => out.push((marker ? marker(i) : '') + line));
    }
    return out.join('\n');
  });
  return blocks.concat('Plan: ' + siteUrl).join('\n\n');
}

function renderHtml_(sections, siteUrl) {
  const parts = sections.map((section) => {
    const heading = section.heading
      ? '<h2 style="font-size:17px;margin:20px 0 6px">' + escapeHtml_(section.heading) + '</h2>'
      : '';
    return heading + (section.rows ? htmlTable_(section) : htmlLines_(section));
  });
  return '<div style="font:16px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:560px">'
    + parts.join('')
    + '<p style="margin-top:24px"><a href="' + escapeHtml_(siteUrl) + '">Open the cooking plan</a></p>'
    + '</div>';
}

function htmlLines_(section) {
  const items = section.lines.map((line) => escapeHtml_(line));
  if (section.style === 'number') return '<ol>' + items.map(listItem_).join('') + '</ol>';
  if (section.style === 'bullet') return '<ul>' + items.map(listItem_).join('') + '</ul>';
  if (section.style === 'check') {
    return items.map((item) => '<p style="margin:6px 0">&#9744; ' + item + '</p>').join('');
  }
  return items.map((item) => '<p style="margin:6px 0">' + item + '</p>').join('');
}

function listItem_(item) {
  return '<li style="margin:4px 0">' + item + '</li>';
}

function htmlTable_(section) {
  const cell = 'padding:6px 8px;border:1px solid #ccc;text-align:left;vertical-align:top';
  const row = (tag, cells) => '<tr>'
    + cells.map((text) => '<' + tag + ' style="' + cell + '">' + escapeHtml_(text) + '</' + tag + '>').join('')
    + '</tr>';
  return '<table style="border-collapse:collapse;width:100%;font-size:15px">'
    + row('th', section.header)
    + section.rows.map((cells) => row('td', cells)).join('')
    + '</table>';
}

function escapeHtml_(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
