-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Provider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "homepage" TEXT,
    "defaultBaseUrl" TEXT,
    "apiProtocols" TEXT[],
    "authentication" JSONB NOT NULL,
    "signup" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanonicalModel" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanonicalModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelOffering" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "providerModelId" TEXT NOT NULL,
    "canonicalModelId" TEXT,
    "description" TEXT,
    "endpoint" JSONB NOT NULL,
    "limits" JSONB NOT NULL,
    "quality" JSONB NOT NULL,
    "policy" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelOffering_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Capability" (
    "id" TEXT NOT NULL,

    CONSTRAINT "Capability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelOfferingCapability" (
    "modelOfferingId" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,

    CONSTRAINT "ModelOfferingCapability_pkey" PRIMARY KEY ("modelOfferingId","capabilityId")
);

-- CreateTable
CREATE TABLE "SourceSnapshot" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "collector" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "body" JSONB NOT NULL,
    "collectorRunId" TEXT NOT NULL,

    CONSTRAINT "SourceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceClaim" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "collector" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "fieldPaths" TEXT[],
    "confidence" TEXT NOT NULL,
    "rawReference" JSONB,
    "modelOfferingId" TEXT,
    "sourceSnapshotId" TEXT,

    CONSTRAINT "SourceClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityObservation" (
    "id" TEXT NOT NULL,
    "modelOfferingId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "successAt" TIMESTAMP(3),
    "staleAfterSeconds" INTEGER,
    "sourceClaimId" TEXT,

    CONSTRAINT "AvailabilityObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingObservation" (
    "id" TEXT NOT NULL,
    "modelOfferingId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "inputUsdPer1mTokens" DECIMAL(65,30),
    "outputUsdPer1mTokens" DECIMAL(65,30),
    "currency" TEXT,
    "metering" TEXT,
    "free" JSONB,
    "subscription" JSONB,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "sourceClaimId" TEXT,

    CONSTRAINT "PricingObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualOverride" (
    "id" TEXT NOT NULL,
    "targetFieldPath" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "visibleInSourceClaims" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManualOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedRelease" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceRevision" TEXT NOT NULL,
    "snapshotJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectorRun" (
    "id" TEXT NOT NULL,
    "collector" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "CollectorRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- AddForeignKey
ALTER TABLE "ModelOffering" ADD CONSTRAINT "ModelOffering_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelOffering" ADD CONSTRAINT "ModelOffering_canonicalModelId_fkey" FOREIGN KEY ("canonicalModelId") REFERENCES "CanonicalModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelOfferingCapability" ADD CONSTRAINT "ModelOfferingCapability_modelOfferingId_fkey" FOREIGN KEY ("modelOfferingId") REFERENCES "ModelOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelOfferingCapability" ADD CONSTRAINT "ModelOfferingCapability_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "Capability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceSnapshot" ADD CONSTRAINT "SourceSnapshot_collectorRunId_fkey" FOREIGN KEY ("collectorRunId") REFERENCES "CollectorRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceClaim" ADD CONSTRAINT "SourceClaim_modelOfferingId_fkey" FOREIGN KEY ("modelOfferingId") REFERENCES "ModelOffering"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceClaim" ADD CONSTRAINT "SourceClaim_sourceSnapshotId_fkey" FOREIGN KEY ("sourceSnapshotId") REFERENCES "SourceSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityObservation" ADD CONSTRAINT "AvailabilityObservation_modelOfferingId_fkey" FOREIGN KEY ("modelOfferingId") REFERENCES "ModelOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingObservation" ADD CONSTRAINT "PricingObservation_modelOfferingId_fkey" FOREIGN KEY ("modelOfferingId") REFERENCES "ModelOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;
