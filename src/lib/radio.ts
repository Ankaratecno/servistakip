export interface RadioStatePayload {
  type: "radio";
  playing: boolean;
  title: string | null;
  index: number;
  total: number;
  ts: number;
}
