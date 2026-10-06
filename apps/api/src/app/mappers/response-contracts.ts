import type {
  AddLocaleToCollectionResult,
  DeleteResourceResult,
  MoveResult,
  RemoveLocaleFromCollectionResult,
} from '@simoncodes-ca/core';
import type {
  AddLocaleResponseDto,
  DeleteResourceResponseDto,
  MoveResourceResponseDto,
  RemoveLocaleResponseDto,
} from '@simoncodes-ca/data-transfer';

type Equal<Left, Right> = (<T>() => T extends Left ? 1 : 2) extends <T>() => T extends Right ? 1 : 2 ? true : false;
type Assert<Condition extends true> = Condition;

/**
 * API typecheck guards payload equality without making core depend on HTTP contracts.
 * Locale results pass through unchanged; resource mappers omit the named internal fields.
 * Readonly normalizes locale result mutability; Required reflects always-present move diagnostics.
 */
export type ResponseContractChecks = [
  Assert<Equal<Readonly<AddLocaleToCollectionResult>, Readonly<AddLocaleResponseDto>>>,
  Assert<Equal<Readonly<RemoveLocaleFromCollectionResult>, Readonly<RemoveLocaleResponseDto>>>,
  Assert<Equal<Omit<DeleteResourceResult, 'outcome' | 'warnings'>, DeleteResourceResponseDto>>,
  Assert<Equal<Omit<MoveResult, 'outcome' | 'foldersDeleted'>, Required<MoveResourceResponseDto>>>,
];
