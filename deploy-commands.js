require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');

const CLIENT_ID = process.env.CLIENT_ID;
const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID; // optional: faster updates

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

    if (GUILD_ID) {
      // Clear old guild commands first
      console.log('🧹 Clearing old guild commands...');
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: [] });

      // Register new commands
      console.log('🚀 Registering commands to guild...');
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
      console.log('✅ Guild commands registered successfully!');
    } else {
      // Clear old global commands first
      console.log('🧹 Clearing old global commands...');
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });

      // Register new commands
      console.log('🚀 Registering global commands...');
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
      console.log('✅ Global commands registered successfully!');
    }

  } catch (error) {
    console.error('❌ Error deploying commands:', error);
  }
})();
