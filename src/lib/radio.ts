export interface RadioStatePayload {
  type: "radio";
  playing: boolean;
  title: string | null;
  index: number;
  total: number;
  ts: number;
}

/** YAPILACAKLAR3 #24: yolcu ses akışı gelmediyse şoförden yeniden çağrı ister. */
export interface RadioRequestPayload {
  type: "radio-req";
  ts: number;
}

/** YAPILACAKLAR3 #27: yolcu "sesi alıyorum / dinliyorum" bildirimi. */
export interface RadioAckPayload {
  type: "audio-ok";
  /** Ses akışı geldi (muted olabilir) */
  stream: boolean;
  /** Yolcu radyoyu açtı, gerçekten duyuyor */
  listening: boolean;
  ts: number;
}
