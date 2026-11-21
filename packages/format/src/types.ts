export const TALKIE_MAJOR = 1;
export interface TalkieAudio {
  src: string;
  type: string;
}
export interface TalkieScene {
  id: string;
  src: string;
  start: number;
  end: number;
}
export interface TalkieChapter {
  title: string;
  start: number;
}
export interface TalkieCaptions {
  lang: string;
  label: string;
  src: string;
}
export interface TalkiePoster {
  svg?: string;
  png: string;
}
export interface TalkieFilm {
  talkie: number;
  title: string;
  duration: number;
  size: [number, number];
  audio: TalkieAudio[];
  scenes: TalkieScene[];
  chapters: TalkieChapter[];
  captions: TalkieCaptions[];
  poster: TalkiePoster;
}
