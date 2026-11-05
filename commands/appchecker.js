/**
 * appchecker.js — Smart rule-based application reviewer for Kavià Café
 *
 * Scores each answer and produces a human-readable review with flags.
 * No external API needed. Drop-in OpenAI/Claude hook at the bottom
 * if you ever want to upgrade to real AI (just set OPENAI_API_KEY or
 * ANTHROPIC_API_KEY in Railway).
 */

// ─── Red flag patterns ────────────────────────────────────────────────────────
const RED_FLAGS = [
    // Age concerns
    { pattern: /\b(10|11|12)\s*(years?\s*old|yr)\b/i,     label: '🔴 Possibly under 13', severity: 'high' },
    { pattern: /\b13\s*(years?\s*old|yr)\b/i,              label: '🟡 Age 13 disclosed', severity: 'medium' },
    { pattern: /\b(14|15)\s*(years?\s*old|yr)\b/i,         label: '🟡 Age 14–15 disclosed', severity: 'medium' },
    { pattern: /\b(elementary|middle school|7th|8th grade)\b/i, label: '🟡 Possible minor indicator', severity: 'medium' },

    // Low-effort answers
    { pattern: /^(yes|no|idk|ok|okay|sure|fine|yep|nah|lol|lmao|😭|dunno)\.?$/i, label: '🟡 One-word / non-answer', severity: 'medium' },
    { pattern: /^.{0,15}$/,                                label: '🟡 Very short answer (<15 chars)', severity: 'low' },

    // Copy-paste / link-only answers
    { pattern: /^https?:\/\/\S+\s*$/,                      label: '🟡 Link-only answer (no explanation)', severity: 'medium' },
    { pattern: /^\s*[""].*[""][\s\S]*https?:\/\//,         label: '🟡 Resume quote without personal response', severity: 'low' },

    // Concerning content
    { pattern: /\b(i don'?t care|don'?t want to|hate (staff|work|this))\b/i, label: '🔴 Negative attitude indicator', severity: 'high' },
    { pattern: /\b(social anxiety|can'?t (talk|voice|speak))\b/i,            label: '🟡 Stated communication limitation', severity: 'low' },
    { pattern: /\b(i'?ve never|first day|don'?t know (kavia|this server|anything))\b/i, label: '🟡 Limited familiarity with Kavià Café', severity: 'low' },
    { pattern: /\b(copied|plagiar|not mine)\b/i,           label: '🔴 Possible plagiarism indicator', severity: 'high' },
];

// ─── Scoring rubric ───────────────────────────────────────────────────────────
// Returns a 0-10 score for one answer
function scoreAnswer(answer, questionText) {
    if (!answer || answer.trim().length === 0) return 0;

    const a = answer.trim();
    const wordCount = a.split(/\s+/).filter(Boolean).length;
    const charCount = a.length;

    let score = 5; // baseline

    // Length scoring
    if (charCount < 10)  score -= 4;
    else if (charCount < 30)  score -= 2;
    else if (charCount < 60)  score -= 1;
    else if (charCount >= 150) score += 1;
    else if (charCount >= 300) score += 2;

    // Word count bonus
    if (wordCount >= 30) score += 1;
    if (wordCount >= 60) score += 1;

    // Link-only penalty
    if (/^https?:\/\/\S+\s*$/.test(a)) score -= 3;

    // Answer contains relevant keywords based on question type
    const qLower = (questionText || '').toLowerCase();

    if (/unprofessional|staff member|handle/i.test(qLower)) {
        // Situational: wants a process/steps
        if (/ticket|report|warn|escalate|demotion|superior/i.test(a)) score += 1;
    }
    if (/why should we choose/i.test(qLower)) {
        if (/experience|skill|contribut|passion/i.test(a)) score += 1;
    }
    if (/inactive|duties/i.test(qLower)) {
        if (/report|strike|warn|superior|escalat/i.test(a)) score += 1;
    }
    if (/customer|arguing/i.test(qLower)) {
        if (/calm|warn|kick|ban|professional|approach/i.test(a)) score += 1;
    }

    // Yes/no questions — single word is fine
    if (/do you understand|have you (read|agreed)/i.test(qLower)) {
        if (/^(yes|no|yep|nope|absolutely|definitely)\.?$/i.test(a)) score = 8; // acceptable
    }

    return Math.max(0, Math.min(10, Math.round(score)));
}

// ─── Per-answer flag scan ─────────────────────────────────────────────────────
function flagAnswer(answer) {
    const flags = [];
    for (const rf of RED_FLAGS) {
        if (rf.pattern.test(answer)) {
            flags.push({ label: rf.label, severity: rf.severity });
        }
    }
    return flags;
}

// ─── Main review function ─────────────────────────────────────────────────────
/**
 * @param {string[]} questions
 * @param {string[]} answers
 * @returns {{ overallScore: number, verdict: string, color: number, summary: string, perQuestion: Array, allFlags: Array }}
 */
function reviewApplication(questions, answers) {
    const perQuestion = questions.map((q, i) => {
        const answer = answers[i] || '';
        const score  = scoreAnswer(answer, q);
        const flags  = flagAnswer(answer);
        return { question: q, answer, score, flags };
    });

    const scores = perQuestion.map(p => p.score);
    const overallScore = scores.length > 0
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10
        : 0;

    const allFlags = perQuestion.flatMap((p, i) =>
        p.flags.map(f => ({ qIndex: i + 1, ...f }))
    );

    const highFlags   = allFlags.filter(f => f.severity === 'high').length;
    const mediumFlags = allFlags.filter(f => f.severity === 'medium').length;
    const lowFlags    = allFlags.filter(f => f.severity === 'low').length;

    // Verdict
    let verdict, color;
    if (highFlags >= 2 || overallScore < 3.5) {
        verdict = '🔴 Likely Decline';
        color   = 0xe74c3c;
    } else if (highFlags === 1 || overallScore < 5.5 || mediumFlags >= 3) {
        verdict = '🟡 Review Carefully';
        color   = 0xf39c12;
    } else if (overallScore >= 7.5 && highFlags === 0 && mediumFlags <= 1) {
        verdict = '🟢 Strong Candidate';
        color   = 0x2ecc71;
    } else {
        verdict = '🔵 Looks Good';
        color   = 0x3498db;
    }

    // Short summary
    const lowEffortCount = perQuestion.filter(p => p.score <= 3).length;
    const strongCount    = perQuestion.filter(p => p.score >= 8).length;

    const summaryParts = [];
    if (strongCount > 0)    summaryParts.push(`${strongCount} strong answer${strongCount > 1 ? 's' : ''}`);
    if (lowEffortCount > 0) summaryParts.push(`${lowEffortCount} low-effort answer${lowEffortCount > 1 ? 's' : ''}`);
    if (highFlags > 0)      summaryParts.push(`${highFlags} high-severity flag${highFlags > 1 ? 's' : ''}`);
    if (mediumFlags > 0)    summaryParts.push(`${mediumFlags} caution flag${mediumFlags > 1 ? 's' : ''}`);
    const summary = summaryParts.length > 0 ? summaryParts.join(' · ') : 'No major concerns detected.';

    return { overallScore, verdict, color, summary, perQuestion, allFlags };
}

// ─── Build the Discord embed(s) for the review ────────────────────────────────
const { EmbedBuilder } = require('discord.js');

/**
 * Returns an array of EmbedBuilders to send as a reply to the log message.
 */
function buildReviewEmbeds(questions, answers, applicantTag, submissionId) {
    const result = reviewApplication(questions, answers);

    const scoreBar = buildScoreBar(result.overallScore);

    // ── Main summary embed ──
    const summaryEmbed = new EmbedBuilder()
        .setTitle(`🤖 AI Application Review`)
        .setColor(result.color)
        .setDescription(
            `**Verdict:** ${result.verdict}\n` +
            `**Score:** ${scoreBar} **${result.overallScore}/10**\n` +
            `**Summary:** ${result.summary}`
        )
        .setFooter({ text: `Automated review • Submission ${submissionId} • Always use your own judgement` })
        .setTimestamp();

    // Flag summary
    if (result.allFlags.length > 0) {
        const flagLines = result.allFlags.map(f =>
            `**Q${f.qIndex}** — ${f.label}`
        ).join('\n');
        summaryEmbed.addFields({ name: '⚠️ Flags Detected', value: flagLines.slice(0, 1024) });
    }

    // ── Per-question breakdown embed ──
    const CHUNK_LIMIT = 5500;
    const breakdownEmbeds = [];
    let fields = [];
    let charCount = 0;

    for (let i = 0; i < result.perQuestion.length; i++) {
        const pq = result.perQuestion[i];
        const qShort = pq.question.length > 60 ? pq.question.slice(0, 57) + '...' : pq.question;
        const flagNote = pq.flags.length > 0 ? `\n${pq.flags.map(f => f.label).join(', ')}` : '';
        const scoreEmoji = pq.score >= 8 ? '🟢' : pq.score >= 5 ? '🔵' : pq.score >= 3 ? '🟡' : '🔴';
        const fieldValue = `${scoreEmoji} **Score: ${pq.score}/10**${flagNote}`;
        const fieldSize = qShort.length + fieldValue.length;

        if (charCount + fieldSize > CHUNK_LIMIT || fields.length >= 25) {
            breakdownEmbeds.push(new EmbedBuilder()
                .setTitle(breakdownEmbeds.length === 0 ? '📊 Per-Question Breakdown' : '📊 ...continued')
                .setColor(result.color)
                .addFields(...fields)
            );
            fields = []; charCount = 0;
        }
        fields.push({ name: `Q${i + 1}: ${qShort}`, value: fieldValue });
        charCount += fieldSize;
    }
    if (fields.length > 0) {
        breakdownEmbeds.push(new EmbedBuilder()
            .setTitle(breakdownEmbeds.length === 0 ? '📊 Per-Question Breakdown' : '📊 ...continued')
            .setColor(result.color)
            .addFields(...fields)
        );
    }

    return [summaryEmbed, ...breakdownEmbeds];
}

function buildScoreBar(score) {
    const filled = Math.round(score);
    const empty  = 10 - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
}

// ─── Optional: real AI hook ───────────────────────────────────────────────────
// If OPENAI_API_KEY or ANTHROPIC_API_KEY is set in Railway, this upgrades the
// review to use actual AI. Falls back to the rule-based scorer if unavailable.
async function getAIReviewOverride(questions, answers) {
    // OpenAI path
    if (process.env.OPENAI_API_KEY) {
        try {
            const { default: OpenAI } = await import('openai').catch(() => ({ default: null }));
            if (!OpenAI) return null;
            const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
            const prompt = buildAIPrompt(questions, answers);
            const res = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 800
            });
            return res.choices[0]?.message?.content || null;
        } catch (e) {
            console.error('[appchecker] OpenAI error:', e.message);
            return null;
        }
    }
    // Anthropic path
    if (process.env.ANTHROPIC_API_KEY) {
        try {
            const Anthropic = await import('@anthropic-ai/sdk').catch(() => null);
            if (!Anthropic?.default) return null;
            const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
            const prompt = buildAIPrompt(questions, answers);
            const res = await client.messages.create({
                model: 'claude-haiku-4-5',
                max_tokens: 800,
                messages: [{ role: 'user', content: prompt }]
            });
            return res.content[0]?.text || null;
        } catch (e) {
            console.error('[appchecker] Anthropic error:', e.message);
            return null;
        }
    }
    return null;
}

function buildAIPrompt(questions, answers) {
    const qa = questions.map((q, i) =>
        `Q${i + 1}: ${q}\nA: ${answers[i] || '(no answer)'}`
    ).join('\n\n');

    return `You are reviewing a staff application for Kavià Café, a Roblox café community. Be fair but honest. Review these Q&A responses and provide:
1. An overall score out of 10
2. A one-line verdict (Strong Candidate / Looks Good / Review Carefully / Likely Decline)
3. 2-3 sentences of feedback covering strengths and concerns
4. Any red flags (age concerns, low effort, poor attitude, plagiarism)

Keep it concise and professional. Do not be overly harsh for minor issues.

${qa}`;
}

module.exports = { reviewApplication, buildReviewEmbeds, getAIReviewOverride };