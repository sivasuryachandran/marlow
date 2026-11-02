/** Text for every sound the game can make, so it can be understood with the sound off. Pure, so a test can prove nothing is missing. */
export const CUE_CAPTION: Record<string, string> = {
  "music.calm": "Music: a slow, quiet theme begins",
  "music.tension.on": "Music: tension rises",
  "music.tension.off": "Music: fades out",
  "sfx.radio.static": "Radio static",
  "sfx.radio.click": "Radio click: your order is heard",
  "sfx.phone.ring": "A phone rings",
  "sfx.stinger.spotted": "Alarm stinger: Marlow has been spotted",
  "sfx.door.creak": "A door creaks",
  "sfx.footsteps.marble": "Footsteps on marble",
  "sfx.footsteps.carpet": "Footsteps on carpet",
  "sfx.footsteps.metal": "Footsteps on metal",
  "sfx.rain": "Rain on the glass (ambience, if turned on)",
  "sfx.hvac": "A low room rumble (ambience, if turned on)",
  "sfx.breath": "Marlow breathing (ambience, if turned on)",
  "sfx.chase": "Chase: the guard is running at Marlow",
  "sfx.guard.alert": "He heard that: the guard's footsteps turn toward Marlow",
  "sfx.alarm": "Silent alarm pulses",
};
export const captionFor = (id: string): string => CUE_CAPTION[id] ?? id;
/** The sound that plays while a reply is pending: the guard pacing where Owl last heard him. */
export const WAITING_CAPTION = "Waiting: the guard paces where you last heard him";
