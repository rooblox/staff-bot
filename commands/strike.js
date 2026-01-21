const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const STAFF_FILE = path.join(__dirname, '../staffDiscipline.json'); // Use your main cache file

module.exports = {
  data: new SlashCommandBuilder()
    .setName('strike')
    .setDescription('Issue a strike to a staff member')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('Staff member to strike')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('rank')
        .setDescription('User rank')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for strike')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('proof')
        .setDescription('Proof (optional)')
        .setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    try {
      const logChannelID = process.env.LOG_CHANNEL_ID;

      const user = interaction.options.getUser('user');
      const rank = interaction.options.getString('rank');
      const reason = interaction.options.getString('reason');
      const proof = interaction.options.getString('proof') || 'Not provided';

      // --- Use the cache instead of reading file ---
      const cache = interaction.client.staffDisciplineCache;

      if (!cache[user.id]) {
        cache[user.id] = { rank, strikes: [] };
      }

      cache[user.id].rank = rank;

      cache[user.id].strikes.push({
        reason,
        date: new Date().toISOString(),
        addedBy: {
          id: interaction.user.id,
          username: interaction.user.username
        },
        removed: false
      });

      // Save immediately
      fs.writeFileSync(STAFF_FILE, JSON.stringify(cache, null, 2));

      const activeStrikes = cache[user.id].strikes.filter(s => !s.removed).length;

      // Build DM message
      const dmMessage = `# 📢 Strike notice

Greetings, ${user}

You have received an official strike at **Kavià Café**. This is your **${activeStrikes}${activeStrikes === 1 ? 'st' : activeStrikes === 2 ? 'nd' : 'th'} strike**.

> 🗒️ *Reason:* **${reason}**

Please reach out to HR if you need clarification.`;

      try { await user.send({ content: dmMessage }); } catch {}

      // Build log embed
      const embed = new EmbedBuilder()
        .setTitle('🛑 Staff Strike Issued')
        .setDescription('A strike has been issued to a staff member.')
        .setColor(0xE74C3C)
        .addFields(
          { name: '👮 Staff User', value: interaction.user.username },
          { name: '⚡ Staff Member Striked', value: user.username },
          { name: '🏷️ Rank', value: rank },
          { name: '📝 Reason', value: reason },
          { name: '📊 Current Strikes', value: String(activeStrikes) },
          { name: '📎 Proof', value: proof }
        )
        .setFooter({ text: 'Human Resources Department' })
        .setTimestamp();

      const logChannel = await interaction.client.channels.fetch(logChannelID);
      if (logChannel?.isTextBased()) {
        await logChannel.send({ embeds: [embed] });
      }

      await interaction.editReply({ content: `✅ ${user.tag} has been issued a strike.` });

    } catch (err) {
      console.error('Error in /strike command:', err);
      try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
    }
  }
};
