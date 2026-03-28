'use strict';

const {
  DEDOCS_VERSION,
  parsePackage,
  serializePackage,
  sha256,
} = require('./format');
const {
  CLI_COMMANDS,
  DESIGN_PILLARS,
  FIDELITY_GUARANTEES,
  TRANSFORM_CATALOG,
} = require('./catalog');

const {
  compareDocxPackages,
  applyTransforms,
  compileDedocsFile,
  compileDedocsText,
  compilePackageToDocx,
  dedocsFromDocx,
  normalizeDedocsFile,
  normalizeDedocsText,
  normalizePackage,
  packageFromDedocsText,
  packageFromDocx,
  readDedocsFile,
  writeDedocsFile,
} = require('./docx');

module.exports = {
  DEDOCS_VERSION,
  CLI_COMMANDS,
  DESIGN_PILLARS,
  FIDELITY_GUARANTEES,
  TRANSFORM_CATALOG,
  applyTransforms,
  compareDocxPackages,
  compileDedocsFile,
  compileDedocsText,
  compilePackageToDocx,
  dedocsFromDocx,
  normalizeDedocsFile,
  normalizeDedocsText,
  normalizePackage,
  packageFromDedocsText,
  packageFromDocx,
  parsePackage,
  readDedocsFile,
  serializePackage,
  sha256,
  writeDedocsFile,
};
