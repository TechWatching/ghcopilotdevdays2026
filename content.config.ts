import { defineCollection, defineContentConfig, z } from '@nuxt/content'

// Use loose schemas: YAML auto-parses dates and ids; we render fields as-is
// in components, so strict zod typing is not needed and risks coercion errors.
export default defineContentConfig({
  collections: {
    speakers: defineCollection({
      type: 'data',
      source: 'speakers/*.yml',
      schema: z.object({
        firstname: z.string(),
        lastname: z.string(),
        slug: z.string().optional(),
        photo: z.string().optional(),
        role: z.string().optional(),
        company: z.object({
          name: z.string(),
          link: z.string().optional(),
          logo: z.string().optional()
        }).optional(),
        talks: z.array(z.coerce.number()).default([]),
        socials: z.array(z.object({
          type: z.string(),
          link: z.string()
        })).default([])
      })
    }),
    talks: defineCollection({
      type: 'data',
      source: 'talks/*.yml',
      schema: z.object({
        // Note: YAML's numeric `id` is intentionally NOT mapped here — it would
        // collide with Nuxt Content's built-in path-based `id` (a string).
        // We join talks ↔ meetups via the `meetup` field instead, and join
        // speakers ↔ talks by parsing the leading number from `stem`.
        title: z.string(),
        meetup: z.coerce.number().optional(),
        abstract: z.string().optional(),
        replay: z.string().optional()
      })
    }),
    meetups: defineCollection({
      type: 'data',
      source: 'meetups/events.yml',
      schema: z.object({
        title: z.string().optional(),
        events: z.array(z.any())
      })
    })
  }
})
