import {ui} from "./interface-language.js";
import {latestConversationExchange} from './conversation-details.js';
import {mapTranscriptText} from './world-dialogue.js';

const meetingDistance = 90;
const visibleFor = 8_000;
const interval = 23_000;

function excerpt(value, limit) {
  const text = mapTranscriptText(value).replace(/\s+/g, ' ').trim();
  const letters = Array.from(text);
  return letters.length > limit ? letters.slice(0, limit - 1).join('') + '…' : text;
}

function inView(person, bounds) {
  return person.x >= bounds.left && person.x <= bounds.right &&
    person.y >= bounds.top && person.y <= bounds.bottom;
}

// The question is local scene dialogue. The answer quotes a saved exchange
// with its source label. Nothing is appended to either character's history.
function dialogue(companion, resident, chat) {
  if (!chat) return null;
  const turn = latestConversationExchange(chat).filter(row => row.text).at(-1);
  const topic = excerpt(chat.title, 30);
  if (!turn || !topic) return null;
  const companionName = excerpt(companion.name, 24);
  const residentName = excerpt(resident.name, 24);
  if (!companionName || !residentName) return null;
  return {
    companionId: companion.conversationId, residentId: resident.conversationId,
    companionName, residentName,
    question: ui('「' + topic + '」の' + (turn.label.includes('依頼') ? '依頼内容' : '続き') + 'を教えて。', `Tell me about “${topic}”.`),
    answer: ui(turn.label + 'より「' + excerpt(turn.text, 82) + '」', `${turn.label}: “${excerpt(turn.text, 82)}”`),
  };
}

export function createAmbientMeetings(getChat) {
  let active = null, until = 0, next = 3_000, rotation = 0;
  const recent = new Map();
  return function update({time, blocked, party, residents, viewport}) {
    if (blocked || !party || party.members.length < 2) {
      active = null;
      next = Math.max(next, time + 3_000);
      return null;
    }
    if (active && time < until) {
      const companion = party.members.find(member => member.conversationId === active.companionId);
      const resident = residents.find(member => member.conversationId === active.residentId);
      if (companion && resident && inView(companion, viewport) && inView(resident, viewport) &&
          Math.hypot(companion.x - resident.x, companion.y - resident.y) < meetingDistance * 1.5) return active;
    }
    active = null;
    if (time < next) return null;
    next = time + 1_000;
    for (const [id, expiry] of recent) if (time >= expiry) recent.delete(id);
    const leader = party.members.find(member => member.isLeader) || party.members[0];
    const partyIds = new Set(party.members.map(member => member.conversationId));
    const companions = party.members.filter(member => member !== leader && member.conversationId && inView(member, viewport));
    for (let index = 0; index < companions.length; index++) {
      const companion = companions[(rotation + index) % companions.length];
      const candidates = residents.filter(person => person.conversationId && !partyIds.has(person.conversationId) &&
        !recent.has(person.conversationId) && inView(person, viewport)).map(person => ({
          person, distance: Math.hypot(person.x - companion.x, person.y - companion.y),
        })).filter(item => item.distance <= meetingDistance).sort((a, b) => a.distance - b.distance);
      for (const {person} of candidates) {
        const lines = dialogue(companion, person, getChat(person.conversationId));
        if (!lines) continue;
        rotation += index + 1;
        until = time + visibleFor;
        next = time + interval;
        recent.set(person.conversationId, time + interval * 3);
        active = lines;
        return active;
      }
    }
    return null;
  };
}

export function createAmbientNotice({frame, controls, getChat, readEnabled, saveEnabled}) {
  const updateMeeting = createAmbientMeetings(getChat);
  let enabled = readEnabled(), shown = null;
  const notice = document.createElement('aside');
  notice.id = 'village-ambient';
  notice.hidden = true;
  notice.setAttribute('aria-label', ui("仲間と村人の立ち話", "Companion conversation"));
  // Passers-by should never interrupt a screen reader or take input focus.
  notice.setAttribute('aria-live', 'off');
  const question = document.createElement('p'), answer = document.createElement('p');
  notice.append(question, answer);
  frame.append(notice);
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.id = 'village-ambient-toggle';
  toggle.textContent = ui("仲間の立ち話", "Companions talking");
  toggle.setAttribute('aria-pressed', String(enabled));
  toggle.setAttribute('aria-controls', notice.id);
  toggle.onclick = () => {
    enabled = !enabled;
    saveEnabled(enabled);
    toggle.setAttribute('aria-pressed', String(enabled));
    if (!enabled) {
      shown = null;
      notice.hidden = true;
    }
  };
  controls.append(toggle);
  return function update(settings) {
    const meeting = updateMeeting({...settings, blocked: settings.blocked || !enabled});
    if (meeting === shown) return;
    shown = meeting;
    notice.hidden = !meeting;
    if (meeting) {
      question.textContent = meeting.companionName + '　' + meeting.question;
      answer.textContent = meeting.residentName + '　' + meeting.answer;
    }
  };
}
