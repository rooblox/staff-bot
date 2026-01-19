require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');

const CLIENT_ID = process.env.CLIENT_ID;
const TOKEN = process.env.TOKEN;

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    const commands = [];
    const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
      const command = require(`./commands/${file}`);
      if (command.data && typeof command.data.toJSON === 'function') {
        commands.push(command.data.toJSON());
      } else {
        console.warn(`⚠️ Skipping command ${file}, missing or invalid "data" export.`);
      }
    }

    console.log('🚀 Registering commands globally...');
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('✅ Global commands registered successfully!');
  } catch (error) {
    console.error(error);
  }
})();
