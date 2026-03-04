# CSV Import Templates

Vanilla Class SRS supports CSV import for two things:

1. **Cards** — bulk-import vocabulary into a CardSet
2. **Students** — bulk-enroll students into a class

---

## Card CSV

### Format

```
word,pos,definition_l2,definition_l1,example_sentence
```

| Column | Required | Description |
|---|---|---|
| `word` | Yes | The target vocabulary word or phrase |
| `pos` | No | Part of speech (e.g. `noun`, `verb`, `adj`) |
| `definition_l2` | At least one of L1/L2 | Definition in the target language (L2) |
| `definition_l1` | At least one of L1/L2 | Definition in the student's native language (L1) |
| `example_sentence` | No | An example sentence using the word in L2 |

**Rules:**
- The header row is required and must use these exact column names.
- Every row must have `word` and at least one of `definition_l1` or `definition_l2`.
- Imports are all-or-nothing: if any row fails validation, the entire import is rejected.
- Leading/trailing whitespace is trimmed automatically.

### Example

```csv
word,pos,definition_l2,definition_l1,example_sentence
ameliorate,verb,to make something bad better,改善,"The new policy will ameliorate the living conditions."
ephemeral,adj,lasting for only a short time,短暂的,"Fame can be ephemeral."
ubiquitous,adj,present everywhere,无处不在的,"Smartphones are now ubiquitous."
pragmatic,adj,dealing with things sensibly and realistically,务实的,
```

---

## Student CSV

### Format

```
name,email
```

| Column | Required | Description |
|---|---|---|
| `name` | Yes | Student's display name |
| `email` | Yes | Student's login email (must be unique across the system) |

**Rules:**
- The header row is required.
- Both `name` and `email` are required for every row.
- If a student with that email already exists, they are enrolled in the class without creating a duplicate account.
- A temporary password is auto-generated and displayed to the teacher after import. Students must change it on first login.
- Imports are all-or-nothing.

### Example

```csv
name,email
Zhang Wei,zhang.wei@school.edu
Li Na,li.na@school.edu
Wang Fang,wang.fang@school.edu
```

---

## Generating Cards with an LLM

No AI is built into Vanilla Class SRS, but you can use any LLM (Claude, ChatGPT, Gemini, etc.) to generate a card CSV from a word list. Copy and paste the prompt below.

### Prompt

```
You are a vocabulary card generator for a spaced repetition flashcard system.

I will give you a list of words. For each word, output one row of a CSV with these exact columns:

word,pos,definition_l2,definition_l1,example_sentence

Rules:
- word: the word exactly as given
- pos: part of speech in lowercase (noun, verb, adj, adv, phrase, etc.)
- definition_l2: a clear, concise definition in English (the target language)
- definition_l1: the translation or equivalent in [NATIVE LANGUAGE] (e.g. Chinese: 中文)
- example_sentence: one natural example sentence using the word in context

Output only the CSV, starting with the header row. No explanation, no markdown code blocks, no extra text.

Word list:
[PASTE YOUR WORD LIST HERE]
```

**Customise before use:**
- Replace `[NATIVE LANGUAGE]` with your students' native language (e.g. `Chinese`, `French`, `Arabic`).
- Replace `[PASTE YOUR WORD LIST HERE]` with a newline-separated or comma-separated list of words.
- If your L2 is not English, adjust the `definition_l2` instruction accordingly.

### Example output (English L2, Chinese L1)

```csv
word,pos,definition_l2,definition_l1,example_sentence
ameliorate,verb,to make something bad or unsatisfactory better,改善,"The government introduced new measures to ameliorate poverty."
ephemeral,adj,lasting for only a short time,短暂的,"Social media trends are often ephemeral."
ubiquitous,adj,seeming to appear everywhere at the same time,无处不在的,"Coffee shops have become ubiquitous in the city centre."
```

### Tips

- Review AI-generated definitions before importing. LLMs occasionally produce inaccurate or unnatural definitions.
- For low-frequency or domain-specific vocabulary, provide extra context in the prompt (e.g. "These are words from a business English textbook").
- You can ask the LLM to regenerate specific rows if a definition looks off.
- The `example_sentence` column is optional — you can delete the column entirely or leave cells blank, and students can add their own example sentences later.
