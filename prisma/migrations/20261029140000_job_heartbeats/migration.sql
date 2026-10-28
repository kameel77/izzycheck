-- CreateTable
CREATE TABLE "job_heartbeats" (
    "name" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3) NOT NULL,
    "lastResultJson" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_heartbeats_pkey" PRIMARY KEY ("name")
);
