import { INIT_REGISTRATION } from '../init/init-flags';
import { ADD_COLLECTION_REGISTRATION } from '../add-collection/add-collection-flags';
import { DELETE_COLLECTION_REGISTRATION } from '../delete-collection/delete-collection-flags';
import { ADD_LOCALE_REGISTRATION } from '../commands/add-locale-flags';
import { REMOVE_LOCALE_REGISTRATION } from '../commands/remove-locale-flags';
import { ADD_RESOURCE_REGISTRATION } from '../add-resource/add-resource-flags';
import { EDIT_RESOURCE_REGISTRATION } from '../commands/edit-resource-flags';
import { DELETE_RESOURCE_REGISTRATION } from '../commands/delete-resource-flags';
import { MOVE_REGISTRATION } from '../commands/move-flags';
import { NORMALIZE_REGISTRATION } from '../commands/normalize-flags';
import { TRANSLATE_LOCALE_REGISTRATION } from '../commands/translate-locale-flags';
import { BUNDLE_REGISTRATION } from '../commands/bundle-flags';
import { EXPORT_REGISTRATION } from '../commands/export-cmd-flags';
import { IMPORT_REGISTRATION } from '../commands/import-cmd-flags';
import { VALIDATE_REGISTRATION } from '../commands/validate-options';
import { FIND_SIMILAR_REGISTRATION } from '../commands/find-similar-flags';
import { GLOSSARY_REGISTRATION } from '../commands/glossary-flags';
import { EDIT_COLLECTION_REGISTRATION } from '../commands/edit-collection-flags';
import { PROTECTED_TERMS_REGISTRATION } from '../commands/protected-terms-flags';
import { PREFERRED_TERMINOLOGY_REGISTRATION } from '../commands/preferred-terminology-flags';
import { INSTALL_SKILL_REGISTRATION } from '../commands/install-skill-flags';

export const commandRegistrations = [
  INIT_REGISTRATION,
  ADD_COLLECTION_REGISTRATION,
  DELETE_COLLECTION_REGISTRATION,
  ADD_LOCALE_REGISTRATION,
  REMOVE_LOCALE_REGISTRATION,
  ADD_RESOURCE_REGISTRATION,
  EDIT_RESOURCE_REGISTRATION,
  DELETE_RESOURCE_REGISTRATION,
  MOVE_REGISTRATION,
  NORMALIZE_REGISTRATION,
  TRANSLATE_LOCALE_REGISTRATION,
  BUNDLE_REGISTRATION,
  EXPORT_REGISTRATION,
  IMPORT_REGISTRATION,
  VALIDATE_REGISTRATION,
  FIND_SIMILAR_REGISTRATION,
  GLOSSARY_REGISTRATION,
  EDIT_COLLECTION_REGISTRATION,
  PROTECTED_TERMS_REGISTRATION,
  PREFERRED_TERMINOLOGY_REGISTRATION,
  INSTALL_SKILL_REGISTRATION,
];
