export type SiteContract = {
 version:string;verified:boolean;account:string;accountAttribute:string|null;
 cards:string;jobLink:string;company:string;salary:string;district:string;city:string;filters:string;empty:string;
 queryPath:string;detail:string;detailJobAttribute:string;conversation:string;conversationAttribute:string;chatJobAttribute:string;recruiterAttribute:string;
 chatJob:string;chatCompany:string;messages:string;messageText:string;messageStatus:string;phraseButton:string;phrases:string;editor:string;send:string;alerts:string;
 phraseMode:'direct'|'fill'|'unknown';
};
/** Candidate read selectors only. Identity/write contract awaits observation in the user's Edge. */
export const productionContract:SiteContract={
 version:'boss-web-unverified',verified:false,account:'.user-name, .user-nav .nav-figure',accountAttribute:null,
 cards:'.job-card-wrapper, .job-card-box',jobLink:'a[href*="/job_detail/"]',company:'.company-name',salary:'.salary',district:'.job-area',
 city:'.city-label, .city-name, .city-select .city',filters:'.filter-select-box, .filter-condition',empty:'.job-empty, .search-empty',queryPath:'/wapi/zpgeek/search/joblist.json',
 detail:'.job-detail-box',detailJobAttribute:'data-job-id',conversation:'.chat-conversation',conversationAttribute:'data-conversation-id',chatJobAttribute:'data-job-id',recruiterAttribute:'data-boss-id',
 chatJob:'.chat-position a[href*="/job_detail/"]',chatCompany:'.chat-company',messages:'.chat-record .message-item.item-myself',messageText:'.text',messageStatus:'.message-status',
 phraseButton:'[title="常用语"], [aria-label="常用语"]',phrases:'.phrase-panel .phrase-item',editor:'textarea.chat-input, .chat-input[contenteditable="true"]',send:'.btn-send',
 alerts:'[role="dialog"], .dialog-wrap, .toast, .toast-content, .error-content, .verify-wrap',phraseMode:'unknown'
};
