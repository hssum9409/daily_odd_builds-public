const paths = {
 loader:'<path d="M12 3a9 9 0 1 1-9 9"/>', document:'<path d="M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8m-8 4h6"/>',
 lens:'<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6m-15-11 3 3 5-5"/>',search:'<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
 // Lucide Settings, ISC license: LUCIDE-LICENSE.txt.
 settings:'<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>',
 globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z"/>',check:'<path d="m5 12 5 5 9-10"/>',cross:'<path d="m6 6 12 12M6 18 18 6"/>',
 question:'<path d="M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 4m0 4h.01"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
 chevron:'<path d="m5 9 7 7 7-7"/>',external:'<path d="M14 3h7v7m0-7L10 14m0-10H4v16h16v-6"/>',original:'<path d="M12 3H4v18h16v-7M7 7h4m-4 4h3"/><circle cx="16" cy="7" r="4"/><path d="m19 10 3 3"/>',
};
export function icon(name, className = '') {
 const span=document.createElement('span');
 span.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="${className}">${paths[name]||paths.question}</svg>`;
 return span.firstChild;
}
