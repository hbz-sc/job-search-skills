// Centralized DOM adapter. Unknown/multiple matches stop instead of coordinate guessing.
export const selectors = {
 account: '.user-name[data-user-id], .user-nav [data-user-id]',
 cards: '.job-card-wrapper, .job-card-box', jobLink: 'a[href*="/job_detail/"]',
 company: '.company-name', salary: '.salary', district: '.job-area',
 city: '.city-label, .city-name, .city-select .city', filters: '.filter-select-box, .filter-condition',
 detail: '.job-detail-box, .job-detail-container',
 conversation: '.chat-conversation', chatJob: '.chat-position a[href*="/job_detail/"]',
 chatCompany: '.chat-company', messages: '.chat-record .message-item.item-myself',
 messageText: '.text', messageStatus: '.message-status',
 phraseButton: '[title="常用语"], [aria-label="常用语"]', phrases: '.phrase-panel .phrase-item',
 editor: 'textarea.chat-input, .chat-input[contenteditable="true"]', send: '.btn-send',
 alerts: '[role="dialog"], .dialog-wrap, .toast, .toast-content, .error-content, .verify-wrap',
};
