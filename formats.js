/*\
title: $:/plugins/rimir/outline/formats.js
type: application/javascript
module-type: library

Registry of outline-format modules: getFormat(type) -> adapter or null.

\*/
"use strict";

exports.getFormat = function(type) {
	type = type || "";
	var found = null;
	$tw.modules.forEachModuleOfType("outline-format", function(title, module) {
		if(!found && module.types && module.types.indexOf(type) !== -1) {
			found = module;
		}
	});
	return found;
};
