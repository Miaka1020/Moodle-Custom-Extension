// Keep the urgency labels independent of the user's chosen colors.
module.exports = function deadlinePalette(settings = {}) {
    const groups = [
        ['deadlineColor', '#2563eb', ['normal'], ['listed'], ['safe']],
        ['deadlineSoonColor', '#ea580c', ['soon'], ['soon'], ['warning']],
        ['deadlineUrgentColor', '#e11d48', ['urgent', 'critical', 'overdue'], ['urgent', 'critical', 'overdue'], ['danger', 'critical', 'expired']]
    ];
    return groups.map(([key, fallback, timeline, checklist, timers]) => {
        const color = /^#[0-9a-f]{6}$/i.test(settings[key]) ? settings[key] : fallback;
        const timelineSelector = timeline.map(state => `html:root body .block_timeline .deadline-highlight[data-mce-deadline="${state}"]`).join(',');
        const checklistSelector = checklist.map(state => `html:root body #mce-course-checklist .mce-checklist-due[data-urgency="${state}"]`).join(',');
        const timerSelector = timers.map(state => `html:root body #customTimetableWidget .custom-countdown-timer .timer-${state}`).join(',');
        return `
            ${timelineSelector}, ${checklistSelector}, ${timerSelector} {
                --mce-deadline-color:${color}!important;
                --mce-deadline-ink:color-mix(in srgb, ${color} 80%, #111827)!important;
            }
            ${[timelineSelector, checklistSelector, timerSelector].join(',').split(',').map(selector => selector.replace('html:root', 'html:root.mce-dark-active')).join(',')} {
                --mce-deadline-ink:color-mix(in srgb, ${color} 55%, white)!important;
            }
            ${timelineSelector} {
                --mce-due-ink:var(--mce-deadline-ink)!important;
                --mce-due-bg:color-mix(in srgb, var(--mce-deadline-color) 14%, transparent)!important;
                --mce-due-edge:color-mix(in srgb, var(--mce-deadline-color) 45%, transparent)!important;
                border:0!important;
                border-bottom:1px solid var(--mce-border,#d9e0e7)!important;
                border-inline-start-width:0!important;
            }
            ${timelineSelector.split(',').map(selector=>selector+' .mce-deadline-badge').join(',')} {
                color:var(--mce-deadline-ink)!important;
                border:0!important;
                background:var(--mce-due-bg)!important;
            }
            ${checklistSelector} {color:var(--mce-deadline-ink)!important;background:color-mix(in srgb, var(--mce-deadline-color) 8%, transparent)!important;}
            ${timerSelector} {color:var(--mce-deadline-ink)!important;}
        `;
    }).join('\n') + `
        html:root body #customTimetableWidget .timetable-deadline-card {
            border-left-width:1px!important;
            border-left-color:var(--mce-border,#d9e0e7)!important;
        }
    `;
};
