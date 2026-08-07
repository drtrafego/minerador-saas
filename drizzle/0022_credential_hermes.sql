-- Adiciona o provider "hermes" ao enum de credenciais (aditivo).
-- Hermes (Nous Research) como cerebro do atendimento, opt-in por org.
ALTER TYPE "minerador_scrapling"."credential_provider" ADD VALUE IF NOT EXISTS 'hermes';
