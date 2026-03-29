const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const MAIN_GUILD_ID = '1370892833182974035';
const ALLIANCE_GUILD_ID = '1385081586285940796';
const ALLIED_REP_ROLE_ID = '1371492999854293024';
const LOG_CHANNEL_ID = '1487904098169655356';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('alliancecheck')
    .setDescription('Check and sync allied rep roles with the alliance server'),

  async execute(interaction, client) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    try {
      const mainGuild = await client.guilds.fetch(MAIN_GUILD_ID);
      const allianceGuild = await client.guilds.fetch(ALLIANCE_GUILD_ID);

      await mainGuild.members.fetch();
      await allianceGuild.members.fetch();

      const mainMembers = mainGuild.members.cache;
      const allianceMembers = allianceGuild.members.cache;

      const rolesAdded = [];
      const rolesRemoved = [];
      const notInMain = [];

      // Check 1: In alliance server but missing allied rep role in main server
      for (const [id, allianceMember] of allianceMembers) {
        if (allianceMember.user.bot) continue;
        const mainMember = mainMembers.get(id);

        if (mainMember && !mainMember.roles.cache.has(ALLIED_REP_ROLE_ID)) {
          try {
            await mainMember.roles.add(ALLIED_REP_ROLE_ID);
            rolesAdded.push(mainMember.user.tag);
          } catch (err) {
            console.error(`Failed to add role to ${allianceMember.user.tag}:`, err);
          }
        }

        if (!mainMember) {
          notInMain.push(allianceMember.user.tag);
        }
      }

      // Check 2: Has allied rep role in main but not in alliance server
      for (const [id, mainMember] of mainMembers) {
        if (mainMember.user.bot) continue;
        if (mainMember.roles.cache.has(ALLIED_REP_ROLE_ID)) {
          const allianceMember = allianceMembers.get(id);
          if (!allianceMember) {
            try {
              await mainMember.roles.remove(ALLIED_REP_ROLE_ID);
              rolesRemoved.push(mainMember.user.tag);
            } catch (err) {
              console.error(`Failed to remove role from ${mainMember.user.tag}:`, err);
            }
          }
        }
      }

      // Truncate lists to avoid Discord 1024 char field limit
      function formatList(arr) {
        if (arr.length === 0) return 'None';
        const display = arr.slice(0, 20);
        const extra = arr.length - 20;
        let result = display.join('\n');
        if (extra > 0) result += `\n*...and ${extra} more*`;
        return result;
      }

      const resultEmbed = new EmbedBuilder()
        .setTitle('🔍 Alliance Check Results')
        .setColor(0x3498DB)
        .addFields(
          { name: `✅ Roles Added (${rolesAdded.length})`, value: formatList(rolesAdded) },
          { name: `❌ Roles Removed (${rolesRemoved.length})`, value: formatList(rolesRemoved) },
          { name: `⚠️ In Alliance Server But Not Main (${notInMain.length})`, value: formatList(notInMain) },
          { name: '📊 Summary', value: `Checked **${mainMembers.size}** main server members and **${allianceMembers.size}** alliance server members.` }
        )
        .setFooter({ text: `Run by ${interaction.user.tag} • Kavià Café` })
        .setTimestamp();

      await interaction.editReply({ embeds: [resultEmbed] });

      // Log to log channel
      try {
        const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
        if (logChannel?.isTextBased()) {
          const logEmbed = new EmbedBuilder()
            .setTitle('🔍 Alliance Check Run')
            .setColor(0x3498DB)
            .addFields(
              { name: '👮 Run By', value: `${interaction.user.tag} (${interaction.user.id})` },
              { name: '✅ Roles Added', value: String(rolesAdded.length) },
              { name: '❌ Roles Removed', value: String(rolesRemoved.length) },
              { name: '⚠️ Not In Main Server', value: String(notInMain.length) }
            )
            .setFooter({ text: 'Kavià Café • Alliance Check' })
            .setTimestamp();

          await logChannel.send({ embeds: [logEmbed] });
        }
      } catch (err) {
        console.error('Error sending alliance check log:', err);
      }

    } catch (err) {
      console.error('Error in /alliancecheck command:', err);
      try { await interaction.editReply({ content: '❌ Error running alliance check. Make sure the bot has the correct permissions in both servers.' }); } catch {}
    }
  }
};