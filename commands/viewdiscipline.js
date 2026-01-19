const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('viewdiscipline')
    .setDescription('View the discipline record of a user')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to view discipline for')
        .setRequired(true)
    ),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user');
    const cache = interaction.client.staffDisciplineCache;

    if (!cache[targetUser.id]) {
      return interaction.reply({ content: '❌ No discipline record found for this user.', ephemeral: true });
    }

    const userRecord = cache[targetUser.id];
    const pages = [];
    const pageSize = 10; // items per page per type

    const buildFields = (array, type) => {
      return array.map((entry, index) => {
        const status = entry.removed ? '✅ Past' : '⚠️ Active';
        const addedBy = entry.addedBy?.username || 'Unknown';
        return {
          name: `${type} #${index + 1} ${status}`,
          value: `**Reason:** ${entry.reason}\n**Date:** ${entry.date}\n**Added By:** ${addedBy}${entry.removed ? `\n**Removed**` : ''}`
        };
      });
    };

    const allEntries = [
      ...buildFields(userRecord.strikes || [], 'Strike'),
      ...buildFields(userRecord.terminations || [], 'Termination'),
      ...buildFields(userRecord.blacklists || [], 'Blacklist')
    ];

    if (allEntries.length === 0) {
      return interaction.reply({ content: '❌ No discipline record found for this user.', ephemeral: true });
    }

    // Create pages
    for (let i = 0; i < allEntries.length; i += pageSize) {
      const embed = new EmbedBuilder()
        .setTitle(`Discipline Record for ${targetUser.tag}`)
        .setColor('#ff0000')
        .setTimestamp()
        .addFields(allEntries.slice(i, i + pageSize));

      pages.push(embed);
    }

    let currentPage = 0;

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('prev')
          .setLabel('Previous')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId('next')
          .setLabel('Next')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(pages.length <= 1)
      );

    const message = await interaction.reply({ embeds: [pages[currentPage]], components: [row], fetchReply: true, ephemeral: true });

    if (pages.length <= 1) return;

    const collector = message.createMessageComponentCollector({ time: 600000 }); // 10 minutes

    collector.on('collect', async i => {
      if (i.user.id !== interaction.user.id) return i.reply({ content: '❌ Only the command user can navigate pages.', ephemeral: true });

      if (i.customId === 'next') currentPage++;
      else if (i.customId === 'prev') currentPage--;

      const newRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('prev')
            .setLabel('Previous')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage === 0),
          new ButtonBuilder()
            .setCustomId('next')
            .setLabel('Next')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage === pages.length - 1)
        );

      await i.update({ embeds: [pages[currentPage]], components: [newRow] });
    });

    collector.on('end', async () => {
      const disabledRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder().setCustomId('prev').setLabel('Previous').setStyle(ButtonStyle.Primary).setDisabled(true),
          new ButtonBuilder().setCustomId('next').setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(true)
        );
      message.edit({ components: [disabledRow] }).catch(() => {});
    });
  }
};
