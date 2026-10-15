import "./env"; // must stay first: loads .env / .env.local for this script
import { prisma } from "../src/lib/prisma";
import { generateCourse } from "../src/lib/ai/pipeline";
import type { Brief } from "../src/lib/validation";

const BRIEFS: Brief[] = [
  {
    topic: "Distributed consensus",
    level: "advanced",
    goal: "so I can reason about failure modes in a production cluster",
    attachments: [],
  },
  { topic: "Type theory", level: "beginner", goal: "", attachments: [] },
  {
    topic: "Shader programming",
    level: "intermediate",
    goal: "to move from graphics into rendering work",
    attachments: [],
  },
];

async function main() {
  console.log("Seeding studio…");

  const existing = await prisma.course.count();
  if (existing > 0) {
    console.log(`Database already holds ${existing} course(s) — nothing to seed.`);
    return;
  }

  const created: string[] = [];

  for (const brief of BRIEFS) {
    process.stdout.write(`  · generating "${brief.topic}" … `);
    const result = await generateCourse(brief);
    created.push(result.slug);
    console.log(`done (${result.source})`);
  }

  // Leave the first course part-way through so progress views have real data.
  const first = await prisma.course.findUnique({
    where: { slug: created[0] },
    include: { modules: { orderBy: { position: "asc" }, include: { lessons: { orderBy: { position: "asc" } } } } },
  });

  if (first) {
    const lessons = first.modules.flatMap((m) => m.lessons).slice(0, 3);
    for (const lesson of lessons) {
      await prisma.progress.create({
        data: { courseId: first.id, lessonId: lesson.id, status: "done" },
      });
    }
    console.log(`  · marked ${lessons.length} lessons complete in "${first.title}"`);

    const questions = await prisma.assessment.findMany({ where: { courseId: first.id } });
    if (questions[0]) {
      await prisma.attempt.create({
        data: {
          assessmentId: questions[0].id,
          answerJson: JSON.stringify({ response: questions[0].answer }),
          correct: true,
          score: questions[0].points,
        },
      });
      console.log("  · recorded one graded attempt");
    }
  }

  console.log(`Seeded ${created.length} course(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());