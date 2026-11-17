import { INITIAL_SECTIONS, INITIAL_SLIDE_THESES } from '../data/initialPitch';
import { ClientMutation, RoomState } from '../types/collaboration';

export function createInitialRoomState(roomId: string): RoomState {
  return {
    roomId,
    version: 1,
    sections: structuredClone(INITIAL_SECTIONS),
    slideTheses: structuredClone(INITIAL_SLIDE_THESES),
    authors: {},
  };
}

export function applyMutation(state: RoomState, msg: ClientMutation): RoomState {
  const nextVersion = state.version + 1;

  switch (msg.type) {
    case 'cue:update': {
      return {
        ...state,
        version: nextVersion,
        authors: {
          ...state.authors,
          [msg.author.id]: { name: msg.author.name, color: msg.author.color },
        },
        sections: state.sections.map((sec) =>
          sec.id !== msg.sectionId
            ? sec
            : {
                ...sec,
                cues: sec.cues.map((c) => (c.id === msg.cueId ? { ...c, html: msg.html } : c)),
              }
        ),
      };
    }

    case 'cue:add': {
      return {
        ...state,
        version: nextVersion,
        sections: state.sections.map((sec) => {
          if (sec.id !== msg.sectionId) return sec;
          if (sec.cues.some((c) => c.id === msg.cue.id)) return sec; // idempotent
          return { ...sec, cues: [...sec.cues, msg.cue] };
        }),
      };
    }

    case 'cue:delete': {
      return {
        ...state,
        version: nextVersion,
        sections: state.sections.map((sec) =>
          sec.id !== msg.sectionId
            ? sec
            : { ...sec, cues: sec.cues.filter((c) => c.id !== msg.cueId) }
        ),
      };
    }

    case 'cue:move': {
      return {
        ...state,
        version: nextVersion,
        sections: state.sections.map((sec) => {
          if (sec.id !== msg.sectionId) return sec;
          const idx = sec.cues.findIndex((c) => c.id === msg.cueId);
          const target = idx + msg.dir;
          if (idx < 0 || target < 0 || target >= sec.cues.length) return sec;
          const copy = [...sec.cues];
          const [item] = copy.splice(idx, 1);
          copy.splice(target, 0, item);
          return { ...sec, cues: copy };
        }),
      };
    }

    case 'cue:speaker': {
      return {
        ...state,
        version: nextVersion,
        sections: state.sections.map((sec) =>
          sec.id !== msg.sectionId
            ? sec
            : {
                ...sec,
                cues: sec.cues.map((c) =>
                  c.id === msg.cueId ? { ...c, speaker: msg.speaker } : c
                ),
              }
        ),
      };
    }

    case 'section:update': {
      return {
        ...state,
        version: nextVersion,
        sections: state.sections.map((sec) =>
          sec.id !== msg.sectionId ? sec : { ...sec, [msg.field]: msg.value }
        ),
      };
    }

    case 'section:add': {
      if (state.sections.some((s) => s.id === msg.section.id)) return state;
      return {
        ...state,
        version: nextVersion,
        sections: [...state.sections, msg.section],
      };
    }

    case 'section:delete': {
      if (state.sections.length <= 1) return state;
      return {
        ...state,
        version: nextVersion,
        sections: state.sections.filter((s) => s.id !== msg.sectionId),
      };
    }

    case 'script:replace': {
      return {
        ...state,
        version: nextVersion,
        sections: msg.sections,
      };
    }

    case 'thesis:add': {
      return {
        ...state,
        version: nextVersion,
        slideTheses: state.slideTheses.map((row) => {
          if (row.id !== msg.slideId) return row;
          if (row.items.some((item) => item.id === msg.item.id)) return row; // idempotent
          return { ...row, items: [...row.items, msg.item] };
        }),
      };
    }

    case 'thesis:update': {
      return {
        ...state,
        version: nextVersion,
        slideTheses: state.slideTheses.map((row) =>
          row.id !== msg.slideId
            ? row
            : {
                ...row,
                items: row.items.map((item) =>
                  item.id === msg.itemId ? { ...item, text: msg.text } : item
                ),
              }
        ),
      };
    }

    case 'thesis:delete': {
      return {
        ...state,
        version: nextVersion,
        slideTheses: state.slideTheses.map((row) =>
          row.id !== msg.slideId
            ? row
            : { ...row, items: row.items.filter((item) => item.id !== msg.itemId) }
        ),
      };
    }

    case 'thesis:rowAdd': {
      if (state.slideTheses.some((r) => r.id === msg.row.id)) return state;
      return {
        ...state,
        version: nextVersion,
        slideTheses: [...state.slideTheses, msg.row],
      };
    }

    case 'author:color': {
      return {
        ...state,
        version: nextVersion,
        authors: {
          ...state.authors,
          [msg.userId]: { name: msg.name, color: msg.color },
        },
      };
    }

    default:
      return state;
  }
}
