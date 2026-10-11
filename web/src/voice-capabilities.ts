/** Layman-facing list of what Realtime Voice can do (mirrors server realtime tools). */

export type VoiceCapability = {
  title: string;
  description: string;
  examples?: string[];
};

export const VOICE_CAPABILITIES_INTRO =
  "Realtime Voice is your microphone and speaker for the same Agent chat you use in Cursor. " +
  "It does not replace Cursor; it sends your words there and reads back short updates.";

export const VOICE_CAPABILITIES: VoiceCapability[] = [
  {
    title: "Send work to the Agent",
    description:
      "Turns what you say into a message in the open Agent panel, as if you typed it and pressed Send. " +
      "Speak in plain language about what you want done in the project.",
    examples: [
      "Run the test suite and summarize any failures.",
      "Fix the lint errors in the auth module.",
      "Explain what this function does in simple terms.",
    ],
  },
  {
    title: "Stop a running Agent",
    description:
      "Stops the Agent if it is still working and you want to interrupt or change direction.",
    examples: ["Stop.", "Cancel that.", "Don't run that anymore."],
  },
  {
    title: "Check what the Agent is doing",
    description:
      "Looks at your Cursor setup and reports which Agent chat is focused, whether a run is in progress, " +
      "and what the Agent last wrote (when the bridge has that information).",
    examples: [
      "Is the agent still working?",
      "What did the agent say last?",
      "Which chat am I in?",
    ],
  },
  {
    title: "Switch to another Agent chat",
    description:
      "Brings a different Agent tab to the front when you have several conversations open.",
    examples: [
      "Switch to the refactor chat.",
      "Open the chat titled browser GPT.",
    ],
  },
  {
    title: "Wait until the Agent finishes",
    description:
      "Waits for the current Agent turn to complete. Usually you do not need to ask; " +
      "the voice assistant is told automatically when hooks are installed. This is a backup when that signal is missing.",
    examples: ["Wait until it's done, then tell me the result."],
  },
];

export const VOICE_CAPABILITIES_FOOTER =
  "Tips: keep the Agent chat you care about open in Cursor. Use Settings for your OpenAI key. " +
  "The live transcript below shows tool activity while you talk.";
