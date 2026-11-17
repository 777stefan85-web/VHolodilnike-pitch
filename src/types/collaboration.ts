export type Speaker = 'Степан' | 'Фёдор' | 'Вместе';

export interface PitchCue {
  id: string;
  speaker: Speaker;
  html: string;
}

export interface PitchSection {
  id: string;
  number: string;
  timeRange: string;
  slides: string;
  defaultSlideId: string;
  title: string;
  insightNote: string;
  cues: PitchCue[];
}

export interface ThesisItem {
  id: string;
  text: string;
  authorId: string;
  authorName: string;
  authorColor: string;
  sourceSectionTitle?: string;
  createdAt: number;
}

export interface SlideThesisRow {
  id: string;
  slideLabel: string;
  slideTitle: string;
  items: ThesisItem[];
}

export interface AuthorProfile {
  id: string;
  name: string;
  color: string;
  activeCueId?: string | null;
  isTyping?: boolean;
  lastSeen: number;
}

export interface RoomState {
  roomId: string;
  version: number;
  sections: PitchSection[];
  slideTheses: SlideThesisRow[];
  authors: Record<string, { name: string; color: string }>;
}

export type ClientMutation =
  | { type: 'cue:update'; sectionId: string; cueId: string; html: string; author: { id: string; name: string; color: string }; clientOpId: string }
  | { type: 'cue:add'; sectionId: string; cue: PitchCue; clientOpId: string }
  | { type: 'cue:delete'; sectionId: string; cueId: string; clientOpId: string }
  | { type: 'cue:move'; sectionId: string; cueId: string; dir: -1 | 1; clientOpId: string }
  | { type: 'cue:speaker'; sectionId: string; cueId: string; speaker: Speaker; clientOpId: string }
  | { type: 'section:update'; sectionId: string; field: 'title' | 'timeRange' | 'slides' | 'insightNote' | 'defaultSlideId'; value: string; clientOpId: string }
  | { type: 'section:add'; section: PitchSection; clientOpId: string }
  | { type: 'section:delete'; sectionId: string; clientOpId: string }
  | { type: 'script:replace'; sections: PitchSection[]; clientOpId: string }
  | { type: 'thesis:add'; slideId: string; item: ThesisItem; clientOpId: string }
  | { type: 'thesis:update'; slideId: string; itemId: string; text: string; clientOpId: string }
  | { type: 'thesis:delete'; slideId: string; itemId: string; clientOpId: string }
  | { type: 'thesis:rowAdd'; row: SlideThesisRow; clientOpId: string }
  | { type: 'author:color'; userId: string; name: string; color: string; clientOpId: string };

export type SyncMessage =
  | { type: 'room:join'; roomId: string; user: AuthorProfile }
  | { type: 'room:state'; state: RoomState; activeUsers: AuthorProfile[]; originOpId?: string }
  | { type: 'presence:update'; user: AuthorProfile }
  | { type: 'presence:list'; activeUsers: AuthorProfile[] }
  | ClientMutation;
