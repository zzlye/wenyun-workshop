export type ReferenceImage = {
    id: string;
    name: string;
    type: string;
    dataUrl: string;
    url?: string;
    storageKey?: string;
    maskDataUrl?: string;
    isMaskTarget?: boolean;
};

export type ReferenceAudio = {
    id: string;
    name: string;
    type: string;
    url?: string;
    storageKey?: string;
    duration?: number;
};

export type ReferenceVideo = {
    id: string;
    name: string;
    type: string;
    url?: string;
    storageKey?: string;
    duration?: number;
};
