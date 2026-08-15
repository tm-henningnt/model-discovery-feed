-- AlterTable
ALTER TABLE "FeedRelease" ADD COLUMN "snapshotGzip" BYTEA;
ALTER TABLE "FeedRelease" ALTER COLUMN "snapshotJson" DROP NOT NULL;
