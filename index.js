import { Client, GatewayIntentBits } from "discord.js";
import OpenAI from "openai";

const required = ["DISCORD_TOKEN", "OPENAI_API_KEY"];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const agents = [
  { name: "Atlas", role: "strategist", focus: "turn ambitious missions into practical plans" },
  { name: "Nova", role: "researcher", focus: "find evidence, opportunities, and missing facts" },
  { name: "Forge", role: "builder", focus: "design tools, prototypes, and technical execution" },
  { name: "Sage", role: "safety and ethics lead", focus: "spot risks and keep work helpful and lawful" },
  { name: "Echo", role: "community lead", focus: "make ideas welcoming, clear, and collaborative" },
];

const history = new Map();

function recent(channelId) {
  return history.get(channelId) ?? [];
}

function remember(channelId, role, content) {
  const next = [...recent(channelId), { role, content }].slice(-16);
  history.set(channelId, next);
}

async function askAgent(agent, mission, peerNotes = "") {
  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5-mini",
    instructions: [
      `You are ${agent.name}, Foundation's ${agent.role}.`,
      `Your focus is to ${agent.focus}.`,
      "Be concise, constructive, honest about uncertainty, and never claim real-world actions you did not perform.",
      "Reply as a distinct teammate in no more than 130 words.",
    ].join(" "),
    input: `${mission}${peerNotes ? `\n\nOther team notes:\n${peerNotes}` : ""}`,
  });
  return response.output_text.trim();
}

async function runCouncil(mission) {
  const firstWave = await Promise.all(agents.slice(0, 3).map(async (agent) => ({
    agent,
    answer: await askAgent(agent, mission),
  })));
  const notes = firstWave.map(({ agent, answer }) => `${agent.name}: ${answer}`).join("\n");
  const secondWave = await Promise.all(agents.slice(3).map(async (agent) => ({
    agent,
    answer: await askAgent(agent, mission, notes),
  })));
  return [...firstWave, ...secondWave];
}

client.once("ready", () => {
  console.log(`Foundation online as ${client.user.tag}`);
  client.user.setActivity("the Foundation mission");
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;

  const mentioned = message.mentions.has(client.user);
  const council = message.content.toLowerCase().startsWith("!council ");
  const status = message.content.toLowerCase() === "!team";
  if (!mentioned && !council && !status) return;

  if (status) {
    await message.reply(`Foundation team online: ${agents.map((a) => `${a.name} (${a.role})`).join(", ")}. Use \`!council your mission\` to call everyone.`);
    return;
  }

  const prompt = council
    ? message.content.slice("!council ".length).trim()
    : message.content.replaceAll(`<@${client.user.id}>`, "").trim();
  if (!prompt) {
    await message.reply("Tell me the mission, or use `!council your mission` to call the whole team.");
    return;
  }

  remember(message.channelId, "user", prompt);
  await message.channel.sendTyping();

  try {
    if (council) {
      const replies = await runCouncil(prompt);
      for (const { agent, answer } of replies) {
        await message.channel.send(`**${agent.name} — ${agent.role}**\n${answer}`);
      }
      await message.channel.send("**Foundation**\nCouncil complete. Choose an idea or ask us to turn the strongest one into an action plan.");
    } else {
      const context = recent(message.channelId).map((item) => `${item.role}: ${item.content}`).join("\n");
      const answer = await askAgent(agents[0], prompt, context);
      remember(message.channelId, "assistant", answer);
      await message.reply(`**Atlas**\n${answer}`);
    }
  } catch (error) {
    console.error(error);
    await message.reply("The Foundation team hit a temporary problem. Please try again in a moment.");
  }
});

client.login(process.env.DISCORD_TOKEN);
