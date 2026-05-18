export interface PageData {
  pageType: 'search' | 'product' | 'category';
  url: string;
  title: string;
  pageText: string;
  listings: ListingItem[];
}

export interface ListingItem {
  id: string;
  title: string;
  price: number;
  sales?: string;
  shopName?: string;
  location?: string;
  link: string;
  imageUrl?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface RoleInfo {
  id: string;
  name: string;
  urlPattern: string;
  prompt: string;
  isBuiltin: boolean;
}

export const MessageTypes = {
  ANALYZE_PAGE: 'ANALYZE_PAGE',
  CHAT_MESSAGE: 'CHAT_MESSAGE',
  AI_RESPONSE: 'AI_RESPONSE',
  AI_THINKING: 'AI_THINKING',
  AI_ERROR: 'AI_ERROR',
  PAGE_CONTEXT: 'PAGE_CONTEXT',
  ASK_CREATE_ROLE: 'ASK_CREATE_ROLE',
  CREATE_ROLE: 'CREATE_ROLE',
  ROLE_CREATED: 'ROLE_CREATED',
  STREAM_COMPLETE: 'STREAM_COMPLETE',
  SWITCH_ROLE: 'SWITCH_ROLE',
  GET_PAGE_DATA: 'GET_PAGE_DATA',
  START_DOM_SELECT: 'START_DOM_SELECT',
  DOM_SELECTED: 'DOM_SELECTED',
  CANCEL_DOM_SELECT: 'CANCEL_DOM_SELECT',
} as const;
