const base = (props) => ({
  viewBox: '0 0 24 24',
  'aria-hidden': 'true',
  ...props,
});

export const BookIcon = (props) => (
  <svg {...base(props)}>
    <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H11a2 2 0 0 1 2 2v14a1.6 1.6 0 0 0-1.6-1.6H5.5A1.5 1.5 0 0 1 4 15.9V4.5Z" />
    <path d="M20 4.5A1.5 1.5 0 0 0 18.5 3H13a2 2 0 0 0-2 2v14a1.6 1.6 0 0 1 1.6-1.6h5.9A1.5 1.5 0 0 0 20 15.9V4.5Z" />
  </svg>
);

export const SearchIcon = (props) => (
  <svg {...base(props)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </svg>
);

export const ChevronDown = (props) => (
  <svg {...base(props)}><path d="m7 10 5 5 5-5" /></svg>
);

export const ChevronLeft = (props) => (
  <svg {...base(props)}><path d="M14 5l-7 7 7 7" /></svg>
);

export const ChevronRight = (props) => (
  <svg {...base(props)}><path d="m10 5 7 7-7 7" /></svg>
);

export const ArrowLeft = (props) => (
  <svg {...base(props)}><path d="M14 5l-7 7 7 7" /></svg>
);

export const MoonIcon = (props) => (
  <svg {...base(props)}><path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z" /></svg>
);

export const LockIcon = (props) => (
  <svg {...base(props)}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.6" />
    <path d="M8 10.5V7.7a4 4 0 0 1 8 0v2.8" />
    <circle cx="12" cy="15.5" r="1.3" />
  </svg>
);

export const CloseIcon = (props) => (
  <svg {...base(props)}><path d="m6 6 12 12M18 6 6 18" /></svg>
);

export const ListIcon = (props) => (
  <svg {...base(props)}><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></svg>
);

export const TypeIcon = (props) => (
  <svg {...base(props)}><path d="M5 6h14M12 6v12M9 18h6" /></svg>
);
