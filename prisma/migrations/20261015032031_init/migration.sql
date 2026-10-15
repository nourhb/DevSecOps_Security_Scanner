-- CreateTable
CREATE TABLE "Repository" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scan" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "runner" TEXT NOT NULL DEFAULT 'local',
    "createdAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "Scan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VulnerabilityFinding" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "packageName" TEXT NOT NULL,
    "installedVersion" TEXT NOT NULL,
    "vulnerabilityId" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "cvssScore" DOUBLE PRECISION,
    "fixedVersion" TEXT,
    "source" TEXT NOT NULL,

    CONSTRAINT "VulnerabilityFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Remediation" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "packageName" TEXT NOT NULL,
    "installedVersion" TEXT NOT NULL,
    "vulnerabilityId" TEXT NOT NULL,
    "fixedVersion" TEXT,
    "advice" TEXT NOT NULL,

    CONSTRAINT "Remediation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Repository_kind_name_idx" ON "Repository"("kind", "name");

-- CreateIndex
CREATE INDEX "Scan_repositoryId_idx" ON "Scan"("repositoryId");

-- CreateIndex
CREATE INDEX "Scan_createdAt_idx" ON "Scan"("createdAt");

-- CreateIndex
CREATE INDEX "VulnerabilityFinding_scanId_idx" ON "VulnerabilityFinding"("scanId");

-- CreateIndex
CREATE INDEX "VulnerabilityFinding_packageName_idx" ON "VulnerabilityFinding"("packageName");

-- CreateIndex
CREATE INDEX "VulnerabilityFinding_vulnerabilityId_idx" ON "VulnerabilityFinding"("vulnerabilityId");

-- CreateIndex
CREATE UNIQUE INDEX "VulnerabilityFinding_scanId_position_key" ON "VulnerabilityFinding"("scanId", "position");

-- CreateIndex
CREATE INDEX "Remediation_scanId_idx" ON "Remediation"("scanId");

-- CreateIndex
CREATE UNIQUE INDEX "Remediation_scanId_position_key" ON "Remediation"("scanId", "position");

-- AddForeignKey
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VulnerabilityFinding" ADD CONSTRAINT "VulnerabilityFinding_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Remediation" ADD CONSTRAINT "Remediation_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
