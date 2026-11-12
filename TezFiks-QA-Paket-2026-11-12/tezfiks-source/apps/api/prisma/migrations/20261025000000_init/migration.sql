-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'DELETED');

-- CreateEnum
CREATE TYPE "AppKind" AS ENUM ('CUSTOMER', 'PRO', 'PANEL', 'ADMIN');

-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('az', 'ru', 'en');

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('INDIVIDUAL', 'COMPANY');

-- CreateEnum
CREATE TYPE "Vertical" AS ENUM ('HOME', 'AUTO');

-- CreateEnum
CREATE TYPE "CategoryKind" AS ENUM ('GROUP', 'SERVICE');

-- CreateEnum
CREATE TYPE "CategoryFlow" AS ENUM ('INSTANT', 'QUOTE');

-- CreateEnum
CREATE TYPE "HandymanKind" AS ENUM ('SOLO', 'COMPANY_WORKER');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "VerificationSubject" AS ENUM ('HANDYMAN', 'COMPANY');

-- CreateEnum
CREATE TYPE "CompanyRole" AS ENUM ('MANAGER', 'WORKER');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'REMOVED');

-- CreateEnum
CREATE TYPE "FinalPriceEntry" AS ENUM ('WORKER', 'MANAGER');

-- CreateEnum
CREATE TYPE "LegalForm" AS ENUM ('MMC', 'ASC', 'QSC', 'FS', 'OTHER');

-- CreateEnum
CREATE TYPE "RequestTiming" AS ENUM ('NOW', 'SCHEDULED', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "ProviderPreference" AS ENUM ('ANY', 'INDIVIDUAL', 'COMPANY');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('SEARCHING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SlotStatus" AS ENUM ('OPEN', 'FILLED', 'DONE', 'CANCELLED', 'UNFILLED');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CLOSED');

-- CreateEnum
CREATE TYPE "OfferTarget" AS ENUM ('HANDYMAN', 'COMPANY');

-- CreateEnum
CREATE TYPE "OfferCloseReason" AS ENUM ('TAKEN', 'EXPIRED', 'CANCELLED', 'SEARCH_ENDED', 'DECLINED');

-- CreateEnum
CREATE TYPE "ProviderType" AS ENUM ('SOLO', 'COMPANY');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'PRICE_PROPOSED', 'PRICE_DISPUTED', 'COMPLETED', 'CANCELLED_FREE', 'CANCELLED_BY_PROVIDER', 'CANCELLED_BY_CUSTOMER', 'DECLINED_ON_ARRIVAL', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "ActorSide" AS ENUM ('CUSTOMER', 'PROVIDER', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ChatSide" AS ENUM ('CUSTOMER', 'PROVIDER');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD');

-- CreateEnum
CREATE TYPE "RatingDirection" AS ENUM ('CUSTOMER_TO_PROVIDER', 'PROVIDER_TO_CUSTOMER');

-- CreateEnum
CREATE TYPE "CaseType" AS ENUM ('GUARANTEE', 'PRICE_DISPUTE', 'REPORT');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'REDISPATCHED', 'RESOLVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('OPEN', 'AWARDED', 'IN_PROGRESS', 'COMPLETED', 'INVOICED', 'PAID', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('SUBMITTED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('ISSUED', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "LedgerOwnerType" AS ENUM ('CUSTOMER_ACCOUNT', 'HANDYMAN', 'COMPANY', 'PLATFORM');

-- CreateEnum
CREATE TYPE "LedgerAccountKind" AS ENUM ('WALLET', 'EARNINGS', 'REVENUE', 'PROMO', 'EXTERNAL', 'PAYOUTS_IN_TRANSIT', 'ADJUSTMENTS');

-- CreateEnum
CREATE TYPE "LedgerTxKind" AS ENUM ('TOPUP', 'ADMIN_ADJUSTMENT', 'REQUEST_FEE_CAPTURE', 'REQUEST_FEE_REFUND', 'EMERGENCY_FEE_CAPTURE', 'EMERGENCY_FEE_REFUND', 'CANCEL_PENALTY', 'PENALTY_COMPENSATION', 'JOB_PAYMENT', 'TIP', 'B2B_FEE_CAPTURE', 'INVOICE_PAYMENT', 'PAYOUT_CREATED', 'PAYOUT_PAID', 'PAYOUT_FAILED');

-- CreateEnum
CREATE TYPE "HoldKind" AS ENUM ('REQUEST_FEE', 'EMERGENCY_FEE', 'B2B_QUOTE_FEE');

-- CreateEnum
CREATE TYPE "HoldStatus" AS ENUM ('ACTIVE', 'CAPTURED', 'RELEASED');

-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('WALLET_TOPUP', 'JOB_PAYMENT', 'TIP', 'INVOICE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PAID', 'FAILED');

-- CreateEnum
CREATE TYPE "PayoutOwnerType" AS ENUM ('HANDYMAN', 'COMPANY');

-- CreateEnum
CREATE TYPE "PayoutMethodType" AS ENUM ('CARD', 'IBAN');

-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('PROFILE_PHOTO', 'REQUEST_PHOTO', 'KYC_ID_FRONT', 'KYC_ID_BACK', 'KYC_SELFIE', 'KYC_SELFIE_TURN', 'KYC_SELFIE_BLINK', 'KYC_TRADE_PROOF', 'COMPANY_DOC', 'REPORT_PHOTO', 'CASE_PHOTO');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('OFFER_NEW', 'OFFER_CLOSED', 'REQUEST_ASSIGNED', 'REQUEST_EXPIRED', 'REQUEST_CANCELLED', 'ASSIGNMENT_EN_ROUTE', 'ASSIGNMENT_NEAR', 'ASSIGNMENT_ARRIVED', 'ASSIGNMENT_CANCELLED', 'PRICE_PROPOSED', 'ASSIGNMENT_COMPLETED', 'PAYMENT_SUCCEEDED', 'TIP_RECEIVED', 'RATING_RECEIVED', 'CHAT_MESSAGE', 'WORKER_ASSIGNED', 'KYC_APPROVED', 'KYC_REJECTED', 'COMPANY_APPROVED', 'COMPANY_REJECTED', 'ACCOUNT_BLOCKED', 'SCHEDULED_REMINDER', 'SCHEDULED_UNFILLED', 'WALLET_LOW', 'WALLET_TOPUP', 'PAYOUT_PAID', 'PROJECT_NEW', 'QUOTE_RECEIVED', 'QUOTE_ACCEPTED', 'QUOTE_REJECTED', 'PROJECT_REPORT', 'INVOICE_ISSUED', 'INVOICE_PAID', 'CASE_UPDATED', 'GENERIC');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('ADMIN', 'OPERATOR');

-- CreateEnum
CREATE TYPE "PushProvider" AS ENUM ('EXPO', 'FCM');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('ADMIN', 'USER', 'SYSTEM');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "photoFileId" UUID,
    "locale" "Locale" NOT NULL DEFAULT 'az',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "blockedReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'OPERATOR',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "adminId" UUID,
    "app" "AppKind" NOT NULL,
    "deviceId" TEXT,
    "refreshTokenHash" TEXT NOT NULL,
    "previousTokenHash" TEXT,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "revokeReason" TEXT,
    "lastUsedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "app" "AppKind" NOT NULL,
    "locale" "Locale" NOT NULL DEFAULT 'az',
    "channel" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMPTZ(3),
    "ip" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "deviceId" TEXT NOT NULL,
    "app" "AppKind" NOT NULL,
    "platform" TEXT NOT NULL,
    "pushToken" TEXT,
    "pushProvider" "PushProvider",
    "appVersion" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "ownerUserId" UUID,
    "kind" "FileKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "purgeAfter" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_accounts" (
    "id" UUID NOT NULL,
    "type" "CustomerType" NOT NULL DEFAULT 'INDIVIDUAL',
    "ownerUserId" UUID NOT NULL,
    "companyName" TEXT,
    "voen" TEXT,
    "legalForm" "LegalForm",
    "contactPerson" TEXT,
    "ratingSum" INTEGER NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "walletAccountId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" UUID NOT NULL,
    "customerAccountId" UUID NOT NULL,
    "label" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "cell7" TEXT NOT NULL,
    "cell9" TEXT NOT NULL,
    "placeId" TEXT,
    "formatted" TEXT NOT NULL,
    "district" TEXT,
    "street" TEXT,
    "building" TEXT,
    "block" TEXT,
    "entrance" TEXT,
    "floor" TEXT,
    "apartment" TEXT,
    "intercom" TEXT,
    "note" TEXT,
    "isSite" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "parentId" UUID,
    "vertical" "Vertical" NOT NULL,
    "kind" "CategoryKind" NOT NULL,
    "nameAz" TEXT NOT NULL,
    "nameRu" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "icon" TEXT,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "flow" "CategoryFlow" NOT NULL DEFAULT 'INSTANT',
    "emergencyAllowed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "handyman_profiles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "HandymanKind" NOT NULL,
    "companyId" UUID,
    "status" "VerificationStatus" NOT NULL DEFAULT 'DRAFT',
    "rejectReason" TEXT,
    "blockedReason" TEXT,
    "serviceRadiusKm" INTEGER NOT NULL DEFAULT 10,
    "baseLat" DOUBLE PRECISION,
    "baseLng" DOUBLE PRECISION,
    "baseCell7" TEXT,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "onlineSince" TIMESTAMPTZ(3),
    "lastLat" DOUBLE PRECISION,
    "lastLng" DOUBLE PRECISION,
    "lastCell7" TEXT,
    "lastSeenAt" TIMESTAMPTZ(3),
    "ratingSum" INTEGER NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "completedCount" INTEGER NOT NULL DEFAULT 0,
    "strikes" INTEGER NOT NULL DEFAULT 0,
    "walletAccountId" UUID,
    "earningsAccountId" UUID,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "handyman_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "handyman_trades" (
    "handymanId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,

    CONSTRAINT "handyman_trades_pkey" PRIMARY KEY ("handymanId","categoryId")
);

-- CreateTable
CREATE TABLE "handyman_service_cells" (
    "handymanId" UUID NOT NULL,
    "cell7" TEXT NOT NULL,

    CONSTRAINT "handyman_service_cells_pkey" PRIMARY KEY ("handymanId","cell7")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "legalForm" "LegalForm" NOT NULL,
    "voen" TEXT NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'DRAFT',
    "rejectReason" TEXT,
    "blockedReason" TEXT,
    "ownerUserId" UUID NOT NULL,
    "finalPriceEntry" "FinalPriceEntry" NOT NULL DEFAULT 'WORKER',
    "isVatPayer" BOOLEAN NOT NULL DEFAULT false,
    "baseLat" DOUBLE PRECISION,
    "baseLng" DOUBLE PRECISION,
    "baseCell7" TEXT,
    "baseAddress" TEXT,
    "serviceRadiusKm" INTEGER NOT NULL DEFAULT 15,
    "ratingSum" INTEGER NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "completedCount" INTEGER NOT NULL DEFAULT 0,
    "strikes" INTEGER NOT NULL DEFAULT 0,
    "walletAccountId" UUID NOT NULL,
    "earningsAccountId" UUID NOT NULL,
    "approvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_trades" (
    "companyId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,

    CONSTRAINT "company_trades_pkey" PRIMARY KEY ("companyId","categoryId")
);

-- CreateTable
CREATE TABLE "company_service_cells" (
    "companyId" UUID NOT NULL,
    "cell7" TEXT NOT NULL,

    CONSTRAINT "company_service_cells_pkey" PRIMARY KEY ("companyId","cell7")
);

-- CreateTable
CREATE TABLE "company_members" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "CompanyRole" NOT NULL,
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMPTZ(3),

    CONSTRAINT "company_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_invites" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "role" "CompanyRole" NOT NULL DEFAULT 'WORKER',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "maxUses" INTEGER NOT NULL DEFAULT 10,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMPTZ(3),
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_submissions" (
    "id" UUID NOT NULL,
    "subject" "VerificationSubject" NOT NULL,
    "handymanId" UUID,
    "companyId" UUID,
    "submittedByUserId" UUID NOT NULL,
    "idFrontFileId" UUID NOT NULL,
    "idBackFileId" UUID NOT NULL,
    "selfieFrontFileId" UUID NOT NULL,
    "selfieTurnFileId" UUID NOT NULL,
    "selfieBlinkFileId" UUID NOT NULL,
    "tradeProofFileIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "companyDocFileIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "selfieChecks" JSONB,
    "consentPolicyVersion" TEXT NOT NULL,
    "consentLocale" TEXT NOT NULL,
    "consentTextHash" TEXT,
    "consentAcceptedAt" TIMESTAMPTZ(3) NOT NULL,
    "consentIp" TEXT,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewedByAdminId" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "rejectReason" TEXT,
    "docNumberLast4" TEXT,
    "birthDate" DATE,
    "docExpiry" DATE,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_access_logs" (
    "id" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "fileId" UUID NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_requests" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "customerAccountId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "vertical" "Vertical" NOT NULL,
    "description" TEXT NOT NULL,
    "timing" "RequestTiming" NOT NULL,
    "scheduledAt" TIMESTAMPTZ(3),
    "slotsRequested" INTEGER NOT NULL DEFAULT 1,
    "providerPreference" "ProviderPreference" NOT NULL DEFAULT 'ANY',
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "cell7" TEXT NOT NULL,
    "cell9" TEXT NOT NULL,
    "formatted" TEXT NOT NULL,
    "placeId" TEXT,
    "district" TEXT,
    "street" TEXT,
    "building" TEXT,
    "block" TEXT,
    "entrance" TEXT,
    "floor" TEXT,
    "apartment" TEXT,
    "intercom" TEXT,
    "note" TEXT,
    "photoFileIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "status" "RequestStatus" NOT NULL DEFAULT 'SEARCHING',
    "isSearching" BOOLEAN NOT NULL DEFAULT true,
    "dispatchStep" INTEGER NOT NULL DEFAULT -1,
    "searchStartedAt" TIMESTAMPTZ(3),
    "searchEndsAt" TIMESTAMPTZ(3),
    "liveDispatchAt" TIMESTAMPTZ(3),
    "isGuaranteeFix" BOOLEAN NOT NULL DEFAULT false,
    "originAssignmentId" UUID,
    "preferredHandymanId" UUID,
    "preferredCompanyId" UUID,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelledBy" "ActorSide",
    "cancelReason" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_slots" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "index" INTEGER NOT NULL,
    "status" "SlotStatus" NOT NULL DEFAULT 'OPEN',
    "emergencyHoldId" UUID,
    "emergencyCaptured" BOOLEAN NOT NULL DEFAULT false,
    "emergencyRefunded" BOOLEAN NOT NULL DEFAULT false,
    "currentAssignmentId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "request_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "targetType" "OfferTarget" NOT NULL,
    "handymanId" UUID,
    "companyId" UUID,
    "step" INTEGER NOT NULL,
    "ring" INTEGER NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'SENT',
    "closeReason" "OfferCloseReason",
    "sentAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "respondedAt" TIMESTAMPTZ(3),
    "deliveredAt" TIMESTAMPTZ(3),
    "seenAt" TIMESTAMPTZ(3),
    "distanceM" INTEGER,
    "candidateWorkers" JSONB,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "slotId" UUID NOT NULL,
    "offerId" UUID,
    "providerType" "ProviderType" NOT NULL,
    "handymanId" UUID NOT NULL,
    "companyId" UUID,
    "acceptedByUserId" UUID NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ACCEPTED',
    "isGuaranteeFix" BOOLEAN NOT NULL DEFAULT false,
    "acceptedAt" TIMESTAMPTZ(3) NOT NULL,
    "freeCancelUntil" TIMESTAMPTZ(3) NOT NULL,
    "enRouteAt" TIMESTAMPTZ(3),
    "arrivedAt" TIMESTAMPTZ(3),
    "priceProposedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "endedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelledBy" "ActorSide",
    "cancelReason" TEXT,
    "feeHoldId" UUID,
    "feeAmount" BIGINT NOT NULL DEFAULT 0,
    "feeCaptured" BOOLEAN NOT NULL DEFAULT false,
    "feeRefunded" BOOLEAN NOT NULL DEFAULT false,
    "laborAmount" BIGINT,
    "materialsAmount" BIGINT,
    "totalAmount" BIGINT,
    "priceEnteredByUserId" UUID,
    "paymentMethod" "PaymentMethod",
    "paymentIntentId" UUID,
    "guaranteeUntil" TIMESTAMPTZ(3),
    "tipAmount" BIGINT,
    "etaSec" INTEGER,
    "etaUpdatedAt" TIMESTAMPTZ(3),
    "distanceM" INTEGER,
    "routePolyline" TEXT,
    "routeDurationSec" INTEGER,
    "routeDistanceM" INTEGER,
    "routeComputedAt" TIMESTAMPTZ(3),
    "routeSource" TEXT,
    "lastLat" DOUBLE PRECISION,
    "lastLng" DOUBLE PRECISION,
    "lastHeading" DOUBLE PRECISION,
    "lastLocationAt" TIMESTAMPTZ(3),
    "contactUnlockedAt" TIMESTAMPTZ(3),
    "customerRatedAt" TIMESTAMPTZ(3),
    "providerRatedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "senderUserId" UUID NOT NULL,
    "senderSide" "ChatSide" NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMPTZ(3),

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ratings" (
    "id" UUID NOT NULL,
    "assignmentId" UUID,
    "projectId" UUID,
    "direction" "RatingDirection" NOT NULL,
    "raterUserId" UUID NOT NULL,
    "handymanId" UUID,
    "companyId" UUID,
    "customerAccountId" UUID,
    "stars" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strike_events" (
    "id" UUID NOT NULL,
    "handymanId" UUID,
    "companyId" UUID,
    "assignmentId" UUID,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clearedAt" TIMESTAMPTZ(3),
    "clearedByAdminId" UUID,

    CONSTRAINT "strike_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cases" (
    "id" UUID NOT NULL,
    "type" "CaseType" NOT NULL,
    "status" "CaseStatus" NOT NULL DEFAULT 'OPEN',
    "assignmentId" UUID,
    "projectId" UUID,
    "openedByUserId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "photoFileIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "resolutionNote" TEXT,
    "resolvedByAdminId" UUID,
    "followUpRequestId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_notes" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "adminId" UUID,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "customerAccountId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "title" TEXT,
    "scope" TEXT NOT NULL,
    "dateFrom" DATE NOT NULL,
    "dateTo" DATE NOT NULL,
    "workDays" INTEGER NOT NULL,
    "workersNeeded" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "photoFileIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "cell7" TEXT NOT NULL,
    "formatted" TEXT NOT NULL,
    "placeId" TEXT,
    "district" TEXT,
    "street" TEXT,
    "building" TEXT,
    "block" TEXT,
    "entrance" TEXT,
    "floor" TEXT,
    "apartment" TEXT,
    "intercom" TEXT,
    "note" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'OPEN',
    "quoteDeadline" TIMESTAMPTZ(3) NOT NULL,
    "awardedQuoteId" UUID,
    "guaranteeUntil" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "providerType" "ProviderType" NOT NULL,
    "handymanId" UUID,
    "companyId" UUID,
    "submittedByUserId" UUID NOT NULL,
    "totalAmount" BIGINT NOT NULL,
    "workers" INTEGER NOT NULL,
    "days" INTEGER NOT NULL,
    "note" TEXT,
    "status" "QuoteStatus" NOT NULL DEFAULT 'SUBMITTED',
    "holdId" UUID,
    "feeAmount" BIGINT NOT NULL DEFAULT 0,
    "feeCaptured" BOOLEAN NOT NULL DEFAULT false,
    "terms" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_reports" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "authorUserId" UUID NOT NULL,
    "reportDate" DATE NOT NULL,
    "note" TEXT NOT NULL,
    "progressPercent" INTEGER NOT NULL,
    "photoFileIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "projectId" UUID NOT NULL,
    "issuerType" "ProviderType" NOT NULL,
    "handymanId" UUID,
    "companyId" UUID,
    "customerAccountId" UUID NOT NULL,
    "subtotal" BIGINT NOT NULL,
    "vatRatePercent" DOUBLE PRECISION NOT NULL,
    "vatAmount" BIGINT NOT NULL,
    "total" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AZN',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMPTZ(3),
    "markedPaidByAdminId" UUID,
    "lines" JSONB NOT NULL,
    "issuerSnapshot" JSONB NOT NULL,
    "customerSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL,
    "ownerType" "LedgerOwnerType" NOT NULL,
    "ownerId" UUID NOT NULL,
    "kind" "LedgerAccountKind" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AZN',
    "postedBalance" BIGINT NOT NULL DEFAULT 0,
    "heldBalance" BIGINT NOT NULL DEFAULT 0,
    "allowNegative" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_transactions" (
    "id" UUID NOT NULL,
    "kind" "LedgerTxKind" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "memo" TEXT,
    "requestId" UUID,
    "assignmentId" UUID,
    "projectId" UUID,
    "paymentIntentId" UUID,
    "payoutId" UUID,
    "invoiceId" UUID,
    "actorType" "AuditActorType",
    "actorId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "balanceAfter" BIGINT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holds" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "kind" "HoldKind" NOT NULL,
    "status" "HoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "requestId" UUID,
    "slotId" UUID,
    "assignmentId" UUID,
    "quoteId" UUID,
    "capturedTxId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(3),

    CONSTRAINT "holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "lockedUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "payment_intents" (
    "id" UUID NOT NULL,
    "purpose" "PaymentPurpose" NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AZN',
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "provider" TEXT NOT NULL DEFAULT 'fake',
    "providerRef" TEXT,
    "payerUserId" UUID,
    "walletAccountId" UUID,
    "assignmentId" UUID,
    "invoiceId" UUID,
    "companyId" UUID,
    "returnUrl" TEXT,
    "idempotencyKey" TEXT,
    "failureReason" TEXT,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL,
    "ownerType" "PayoutOwnerType" NOT NULL,
    "handymanId" UUID,
    "companyId" UUID,
    "amount" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AZN',
    "periodStart" TIMESTAMPTZ(3) NOT NULL,
    "periodEnd" TIMESTAMPTZ(3) NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "methodSnapshot" JSONB,
    "failureReason" TEXT,
    "paidAt" TIMESTAMPTZ(3),
    "markedByAdminId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_methods" (
    "id" UUID NOT NULL,
    "handymanId" UUID,
    "companyId" UUID,
    "type" "PayoutMethodType" NOT NULL,
    "maskedNumber" TEXT NOT NULL,
    "holderName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payout_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_classifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "fileId" UUID NOT NULL,
    "model" TEXT NOT NULL,
    "resultSlug" TEXT,
    "confidence" TEXT,
    "candidates" JSONB,
    "latencyMs" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "finalCategoryId" UUID,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_classifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedByAdminId" UUID,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorType" "AuditActorType" NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refreshTokenHash_key" ON "sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_adminId_idx" ON "sessions"("adminId");

-- CreateIndex
CREATE INDEX "sessions_previousTokenHash_idx" ON "sessions"("previousTokenHash");

-- CreateIndex
CREATE INDEX "otp_challenges_phone_createdAt_idx" ON "otp_challenges"("phone", "createdAt");

-- CreateIndex
CREATE INDEX "devices_pushToken_idx" ON "devices"("pushToken");

-- CreateIndex
CREATE UNIQUE INDEX "devices_userId_deviceId_app_key" ON "devices"("userId", "deviceId", "app");

-- CreateIndex
CREATE UNIQUE INDEX "files_storageKey_key" ON "files"("storageKey");

-- CreateIndex
CREATE INDEX "files_ownerUserId_idx" ON "files"("ownerUserId");

-- CreateIndex
CREATE INDEX "files_purgeAfter_idx" ON "files"("purgeAfter");

-- CreateIndex
CREATE UNIQUE INDEX "customer_accounts_ownerUserId_key" ON "customer_accounts"("ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_accounts_walletAccountId_key" ON "customer_accounts"("walletAccountId");

-- CreateIndex
CREATE INDEX "addresses_customerAccountId_idx" ON "addresses"("customerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_parentId_idx" ON "categories"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "handyman_profiles_userId_key" ON "handyman_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "handyman_profiles_walletAccountId_key" ON "handyman_profiles"("walletAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "handyman_profiles_earningsAccountId_key" ON "handyman_profiles"("earningsAccountId");

-- CreateIndex
CREATE INDEX "handyman_profiles_status_idx" ON "handyman_profiles"("status");

-- CreateIndex
CREATE INDEX "handyman_profiles_companyId_idx" ON "handyman_profiles"("companyId");

-- CreateIndex
CREATE INDEX "handyman_profiles_lastCell7_idx" ON "handyman_profiles"("lastCell7");

-- CreateIndex
CREATE INDEX "handyman_trades_categoryId_idx" ON "handyman_trades"("categoryId");

-- CreateIndex
CREATE INDEX "handyman_service_cells_cell7_idx" ON "handyman_service_cells"("cell7");

-- CreateIndex
CREATE UNIQUE INDEX "companies_voen_key" ON "companies"("voen");

-- CreateIndex
CREATE UNIQUE INDEX "companies_walletAccountId_key" ON "companies"("walletAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "companies_earningsAccountId_key" ON "companies"("earningsAccountId");

-- CreateIndex
CREATE INDEX "companies_status_idx" ON "companies"("status");

-- CreateIndex
CREATE INDEX "company_trades_categoryId_idx" ON "company_trades"("categoryId");

-- CreateIndex
CREATE INDEX "company_service_cells_cell7_idx" ON "company_service_cells"("cell7");

-- CreateIndex
CREATE INDEX "company_members_userId_idx" ON "company_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "company_members_companyId_userId_key" ON "company_members"("companyId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "company_invites_token_key" ON "company_invites"("token");

-- CreateIndex
CREATE INDEX "company_invites_companyId_idx" ON "company_invites"("companyId");

-- CreateIndex
CREATE INDEX "verification_submissions_handymanId_createdAt_idx" ON "verification_submissions"("handymanId", "createdAt");

-- CreateIndex
CREATE INDEX "verification_submissions_companyId_createdAt_idx" ON "verification_submissions"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "verification_submissions_status_idx" ON "verification_submissions"("status");

-- CreateIndex
CREATE INDEX "kyc_access_logs_fileId_idx" ON "kyc_access_logs"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "service_requests_number_key" ON "service_requests"("number");

-- CreateIndex
CREATE INDEX "service_requests_customerAccountId_createdAt_idx" ON "service_requests"("customerAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "service_requests_status_idx" ON "service_requests"("status");

-- CreateIndex
CREATE INDEX "service_requests_cell7_idx" ON "service_requests"("cell7");

-- CreateIndex
CREATE INDEX "service_requests_isSearching_idx" ON "service_requests"("isSearching");

-- CreateIndex
CREATE UNIQUE INDEX "request_slots_requestId_index_key" ON "request_slots"("requestId", "index");

-- CreateIndex
CREATE INDEX "offers_handymanId_status_idx" ON "offers"("handymanId", "status");

-- CreateIndex
CREATE INDEX "offers_companyId_status_idx" ON "offers"("companyId", "status");

-- CreateIndex
CREATE INDEX "offers_status_expiresAt_idx" ON "offers"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "offers_requestId_handymanId_key" ON "offers"("requestId", "handymanId");

-- CreateIndex
CREATE UNIQUE INDEX "offers_requestId_companyId_key" ON "offers"("requestId", "companyId");

-- CreateIndex
CREATE INDEX "assignments_handymanId_status_idx" ON "assignments"("handymanId", "status");

-- CreateIndex
CREATE INDEX "assignments_companyId_status_idx" ON "assignments"("companyId", "status");

-- CreateIndex
CREATE INDEX "assignments_requestId_idx" ON "assignments"("requestId");

-- CreateIndex
CREATE INDEX "assignments_status_idx" ON "assignments"("status");

-- CreateIndex
CREATE INDEX "chat_messages_assignmentId_createdAt_idx" ON "chat_messages"("assignmentId", "createdAt");

-- CreateIndex
CREATE INDEX "ratings_handymanId_idx" ON "ratings"("handymanId");

-- CreateIndex
CREATE INDEX "ratings_companyId_idx" ON "ratings"("companyId");

-- CreateIndex
CREATE INDEX "ratings_customerAccountId_idx" ON "ratings"("customerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "ratings_assignmentId_direction_key" ON "ratings"("assignmentId", "direction");

-- CreateIndex
CREATE UNIQUE INDEX "ratings_projectId_direction_key" ON "ratings"("projectId", "direction");

-- CreateIndex
CREATE INDEX "strike_events_handymanId_idx" ON "strike_events"("handymanId");

-- CreateIndex
CREATE INDEX "strike_events_companyId_idx" ON "strike_events"("companyId");

-- CreateIndex
CREATE INDEX "cases_status_idx" ON "cases"("status");

-- CreateIndex
CREATE INDEX "cases_assignmentId_idx" ON "cases"("assignmentId");

-- CreateIndex
CREATE INDEX "cases_openedByUserId_idx" ON "cases"("openedByUserId");

-- CreateIndex
CREATE INDEX "case_notes_caseId_idx" ON "case_notes"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "projects_number_key" ON "projects"("number");

-- CreateIndex
CREATE UNIQUE INDEX "projects_awardedQuoteId_key" ON "projects"("awardedQuoteId");

-- CreateIndex
CREATE INDEX "projects_status_idx" ON "projects"("status");

-- CreateIndex
CREATE INDEX "projects_cell7_idx" ON "projects"("cell7");

-- CreateIndex
CREATE INDEX "projects_customerAccountId_idx" ON "projects"("customerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_projectId_handymanId_key" ON "quotes"("projectId", "handymanId");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_projectId_companyId_key" ON "quotes"("projectId", "companyId");

-- CreateIndex
CREATE INDEX "project_reports_projectId_idx" ON "project_reports"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_projectId_key" ON "invoices"("projectId");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_ownerType_ownerId_kind_currency_key" ON "ledger_accounts"("ownerType", "ownerId", "kind", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_idempotencyKey_key" ON "ledger_transactions"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ledger_transactions_requestId_idx" ON "ledger_transactions"("requestId");

-- CreateIndex
CREATE INDEX "ledger_transactions_assignmentId_idx" ON "ledger_transactions"("assignmentId");

-- CreateIndex
CREATE INDEX "ledger_transactions_createdAt_idx" ON "ledger_transactions"("createdAt");

-- CreateIndex
CREATE INDEX "ledger_entries_accountId_createdAt_idx" ON "ledger_entries"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "ledger_entries_transactionId_idx" ON "ledger_entries"("transactionId");

-- CreateIndex
CREATE INDEX "holds_accountId_status_idx" ON "holds"("accountId", "status");

-- CreateIndex
CREATE INDEX "holds_assignmentId_idx" ON "holds"("assignmentId");

-- CreateIndex
CREATE INDEX "holds_requestId_idx" ON "holds"("requestId");

-- CreateIndex
CREATE INDEX "idempotency_keys_createdAt_idx" ON "idempotency_keys"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_idempotencyKey_key" ON "payment_intents"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payment_intents_payerUserId_idx" ON "payment_intents"("payerUserId");

-- CreateIndex
CREATE INDEX "payment_intents_assignmentId_idx" ON "payment_intents"("assignmentId");

-- CreateIndex
CREATE INDEX "payment_intents_status_idx" ON "payment_intents"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_idempotencyKey_key" ON "payouts"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payouts_status_idx" ON "payouts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payout_methods_handymanId_key" ON "payout_methods"("handymanId");

-- CreateIndex
CREATE UNIQUE INDEX "payout_methods_companyId_key" ON "payout_methods"("companyId");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_classifications_userId_idx" ON "ai_classifications"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_at_idx" ON "audit_logs"("at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_photoFileId_fkey" FOREIGN KEY ("photoFileId") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_walletAccountId_fkey" FOREIGN KEY ("walletAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handyman_profiles" ADD CONSTRAINT "handyman_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handyman_profiles" ADD CONSTRAINT "handyman_profiles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handyman_profiles" ADD CONSTRAINT "handyman_profiles_walletAccountId_fkey" FOREIGN KEY ("walletAccountId") REFERENCES "ledger_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handyman_profiles" ADD CONSTRAINT "handyman_profiles_earningsAccountId_fkey" FOREIGN KEY ("earningsAccountId") REFERENCES "ledger_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handyman_trades" ADD CONSTRAINT "handyman_trades_handymanId_fkey" FOREIGN KEY ("handymanId") REFERENCES "handyman_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handyman_trades" ADD CONSTRAINT "handyman_trades_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handyman_service_cells" ADD CONSTRAINT "handyman_service_cells_handymanId_fkey" FOREIGN KEY ("handymanId") REFERENCES "handyman_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_walletAccountId_fkey" FOREIGN KEY ("walletAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_earningsAccountId_fkey" FOREIGN KEY ("earningsAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_trades" ADD CONSTRAINT "company_trades_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_trades" ADD CONSTRAINT "company_trades_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_service_cells" ADD CONSTRAINT "company_service_cells_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_invites" ADD CONSTRAINT "company_invites_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_submissions" ADD CONSTRAINT "verification_submissions_handymanId_fkey" FOREIGN KEY ("handymanId") REFERENCES "handyman_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_submissions" ADD CONSTRAINT "verification_submissions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_slots" ADD CONSTRAINT "request_slots_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_handymanId_fkey" FOREIGN KEY ("handymanId") REFERENCES "handyman_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "request_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_handymanId_fkey" FOREIGN KEY ("handymanId") REFERENCES "handyman_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strike_events" ADD CONSTRAINT "strike_events_handymanId_fkey" FOREIGN KEY ("handymanId") REFERENCES "handyman_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strike_events" ADD CONSTRAINT "strike_events_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_notes" ADD CONSTRAINT "case_notes_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_handymanId_fkey" FOREIGN KEY ("handymanId") REFERENCES "handyman_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_reports" ADD CONSTRAINT "project_reports_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holds" ADD CONSTRAINT "holds_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_handymanId_fkey" FOREIGN KEY ("handymanId") REFERENCES "handyman_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_methods" ADD CONSTRAINT "payout_methods_handymanId_fkey" FOREIGN KEY ("handymanId") REFERENCES "handyman_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_methods" ADD CONSTRAINT "payout_methods_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
