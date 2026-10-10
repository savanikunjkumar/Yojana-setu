-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'TRANSGENDER');

-- CreateEnum
CREATE TYPE "SocialCategory" AS ENUM ('GENERAL', 'EWS', 'OBC', 'SC', 'ST', 'MINORITY');

-- CreateEnum
CREATE TYPE "Occupation" AS ENUM ('FARMER', 'AGRICULTURAL_LABOURER', 'DAILY_WAGE_LABOURER', 'ARTISAN', 'WEAVER', 'FISHERMAN', 'LIVESTOCK_REARER', 'STREET_VENDOR', 'SMALL_BUSINESS_OWNER', 'SELF_EMPLOYED', 'SALARIED_PRIVATE', 'GOVERNMENT_EMPLOYEE', 'STUDENT', 'HOMEMAKER', 'UNEMPLOYED', 'RETIRED', 'OTHER');

-- CreateEnum
CREATE TYPE "IncomeBracket" AS ENUM ('BELOW_50K', 'INR_50K_TO_1L', 'INR_1L_TO_2_5L', 'INR_2_5L_TO_5L', 'INR_5L_TO_8L', 'INR_8L_TO_10L', 'ABOVE_10L');

-- CreateEnum
CREATE TYPE "SchemeCategory" AS ENUM ('AGRICULTURE', 'EDUCATION', 'HEALTHCARE', 'HOUSING', 'EMPLOYMENT', 'SKILL_DEVELOPMENT', 'FINANCIAL_INCLUSION', 'SOCIAL_SECURITY', 'WOMEN_AND_CHILD', 'ENTREPRENEURSHIP', 'ENERGY', 'WATER_AND_SANITATION', 'DISABILITY_WELFARE', 'SENIOR_CITIZEN', 'TRANSPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "schemes" (
    "id" UUID NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "ministry" VARCHAR(200) NOT NULL,
    "state" VARCHAR(8),
    "category" "SchemeCategory" NOT NULL,
    "benefit_text" TEXT NOT NULL,
    "application_url" VARCHAR(600) NOT NULL,
    "eligibility" JSONB NOT NULL,
    "required_documents" TEXT[],
    "source_url" VARCHAR(600) NOT NULL,
    "last_scraped_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "schemes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applicants" (
    "id" UUID NOT NULL,
    "age" INTEGER,
    "gender" "Gender",
    "income_bracket" "IncomeBracket",
    "occupation" "Occupation",
    "state" VARCHAR(8),
    "district" VARCHAR(120),
    "social_category" "SocialCategory",
    "land_holding" DECIMAL(10,4),
    "is_student" BOOLEAN,
    "has_disability" BOOLEAN,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "applicants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" UUID NOT NULL,
    "applicant_id" UUID NOT NULL,
    "scheme_id" UUID NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "applied_at" TIMESTAMPTZ(3),
    "last_checked_at" TIMESTAMPTZ(3),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "schemes_category_idx" ON "schemes"("category");

-- CreateIndex
CREATE INDEX "schemes_state_idx" ON "schemes"("state");

-- CreateIndex
CREATE INDEX "schemes_eligibility_idx" ON "schemes" USING GIN ("eligibility");

-- CreateIndex
CREATE UNIQUE INDEX "schemes_name_state_key" ON "schemes"("name", "state");

-- CreateIndex
CREATE INDEX "applicants_state_idx" ON "applicants"("state");

-- CreateIndex
CREATE INDEX "applicants_created_at_idx" ON "applicants"("created_at");

-- CreateIndex
CREATE INDEX "applications_status_idx" ON "applications"("status");

-- CreateIndex
CREATE INDEX "applications_applicant_id_idx" ON "applications"("applicant_id");

-- CreateIndex
CREATE INDEX "applications_scheme_id_idx" ON "applications"("scheme_id");

-- CreateIndex
CREATE UNIQUE INDEX "applications_applicant_scheme_key" ON "applications"("applicant_id", "scheme_id");

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "applicants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_scheme_id_fkey" FOREIGN KEY ("scheme_id") REFERENCES "schemes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
