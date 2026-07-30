'use strict';

var DVHelper = require('../ui/helpers/DataViewHelper');

/**
 * Sort keys alphabetically (case-insensitive).
 * @param {Array} keys
 * @returns {Array}
 */
function sortKeysAlphabetically(keys) {
    return keys.slice().sort(function (a, b) {
        return a.toLowerCase().localeCompare(b.toLowerCase());
    });
}

/**
 * Format a timestamp as HH:MM:SS.
 * @param {number} timestamp
 * @returns {string}
 */
function formatTime(timestamp) {
    var d = new Date(timestamp);
    var h = ('0' + d.getHours()).slice(-2);
    var m = ('0' + d.getMinutes()).slice(-2);
    var s = ('0' + d.getSeconds()).slice(-2);
    return h + ':' + m + ':' + s;
}

function _escapeHtml(value) {
    return String(value === null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function _escapeAttr(value) {
    return _escapeHtml(value);
}

function _truncate(value, max) {
    var s = String(value === null ? '' : value);
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/**
 * InspectorRecorder — accumulates UI5 controls inspected by clicking them in the page
 * while recording is on. Displays their Properties and Bindings in expandable sections.
 *
 * @param {string} containerId - id of the DOM container element
 * @param {Object} [options]
 * @param {Function} [options.onToggleRecording] - called with the new recording state (boolean)
 * @constructor
 */
function InspectorRecorder(containerId, options) {
    this._container = document.getElementById(containerId);
    this._entries = [];
    this._isRecording = false;
    this._onToggleRecording = (options && options.onToggleRecording) || function () {};
    this._render();
    this._onClickHandler();
}

/**
 * @returns {boolean}
 */
InspectorRecorder.prototype.isRecording = function () {
    return this._isRecording;
};

/**
 * Add a recorded control entry. Newest entries appear first.
 * @param {string} controlId
 * @param {string} controlType
 * @param {Object} controlProperties - DataView-formatted properties
 * @param {Object} controlBindings - DataView-formatted bindings
 * @param {Object} [action] - { type: 'click' } or { type: 'type', value: string }
 * @param {Object} [controlTreeData] - simplified ControlTree data scoped to this control
 */
InspectorRecorder.prototype.addEntry = function (controlId, controlType, controlProperties, controlBindings, action, controlTreeData) {
    this._entries.unshift({
        controlId: controlId || 'unknown',
        controlType: controlType || 'Unknown Control',
        timestamp: Date.now(),
        controlProperties: controlProperties,
        controlBindings: controlBindings,
        action: action || { type: 'click' },
        controlTreeData: controlTreeData
    });
    this._render();
};

/**
 * Clear all recorded entries.
 */
InspectorRecorder.prototype.clear = function () {
    this._entries = [];
    this._render();
};

/**
 * Get number of recorded entries.
 * @returns {number}
 */
InspectorRecorder.prototype.getEntryCount = function () {
    return this._entries.length;
};

/**
 * Render the full recorder view.
 * @private
 */
InspectorRecorder.prototype._render = function () {
    var html = '';

    // Header bar
    html += '<div class="recorder-header">';
    html += '<span class="recorder-count">Recorded Controls (' + this._entries.length + ')</span>';
    html += '<div class="recorder-header-actions">';
    var recordBtnClass = 'recorder-record-btn' + (this._isRecording ? ' is-recording' : '');
    var recordBtnLabel = this._isRecording ? 'Stop Recording' : 'Record';
    html += '<button class="' + recordBtnClass + '"><span class="recorder-record-dot"></span>' + recordBtnLabel + '</button>';
    if (this._entries.length > 0) {
        html += '<button class="recorder-clear-btn">Clear All</button>';
    }
    html += '</div>';
    html += '</div>';

    if (this._entries.length === 0) {
        html += '<div class="recorder-empty">';
        var emptyMsg = this._isRecording ?
            'Recording… click a UI5 control or type into a UI5 input in the page to record it.' :
            'No controls recorded. Click "Record" and then click or type into a UI5 control in the page to record it.';
        html += DVHelper.wrapInTag('no-data', emptyMsg);
        html += '</div>';
    } else {
        html += '<div class="recorder-entries">';
        for (var i = 0; i < this._entries.length; i++) {
            html += this._renderEntry(this._entries[i], i);
        }
        html += '</div>';
    }

    this._container.innerHTML = html;
};

/**
 * Render a single recorded entry.
 * @param {Object} entry
 * @param {number} index
 * @returns {string}
 * @private
 */
InspectorRecorder.prototype._renderEntry = function (entry, index) {
    var html = '';
    var action = entry.action || { type: 'click' };
    var actionLabel = action.type === 'type' ? 'Typed' : 'Clicked';
    var actionClass = action.type === 'type' ? 'is-type' : 'is-click';

    html += '<div class="recorder-entry" data-entry-index="' + index + '">';

    // Entry header (collapsible)
    html += '<div class="recorder-entry-header">';
    html += DVHelper.addArrow(true);
    html += '<span class="recorder-entry-action ' + actionClass + '">' + actionLabel + '</span>';
    html += DVHelper.wrapInTag('section-title', entry.controlType + ' (' + entry.controlId + ')');
    if (action.type === 'type') {
        html += '<span class="recorder-entry-typed-value" title="' + _escapeAttr(action.value) + '">"' + _escapeHtml(_truncate(action.value, 60)) + '"</span>';
    }
    html += '<span class="recorder-entry-timestamp">' + formatTime(entry.timestamp) + '</span>';
    html += '</div>';

    // Entry body (expandable)
    html += '<div class="recorder-entry-body">';

    // Properties section
    html += this._renderDataSection('Properties', entry.controlProperties);

    // Bindings section
    html += this._renderDataSection('Bindings', entry.controlBindings);

    // Simplified control tree section (rendered last)
    html += this._renderControlTreeSection('Control Tree', entry.controlTreeData, entry.controlId);

    html += '</div>'; // .recorder-entry-body
    html += '</div>'; // .recorder-entry

    return html;
};

/**
 * Render a data section (Properties or Bindings) using DataView HTML patterns.
 * @param {string} title
 * @param {Object} dataViewData - DataView-formatted data object
 * @returns {string}
 * @private
 */
InspectorRecorder.prototype._renderDataSection = function (title, dataViewData) {
    var html = '';

    html += '<div class="recorder-section">';

    // Section title with arrow
    html += DVHelper.openUL({ expandable: 'true' });
    html += DVHelper.openLI();
    html += DVHelper.addArrow(false);
    html += DVHelper.wrapInTag('section-title', title);

    if (!dataViewData || typeof dataViewData !== 'object' || this._isDataEmpty(dataViewData)) {
        // No data
        html += DVHelper.openUL({ expanded: 'true' });
        html += DVHelper.openLI();
        html += DVHelper.wrapInTag('no-data', 'No Available Data');
        html += DVHelper.closeLI();
        html += DVHelper.closeUL();
    } else {
        // Render each sub-section from the DataView-formatted object
        html += DVHelper.openUL({ expandable: 'true' });
        for (var key in dataViewData) {
            if (key === 'isPropertiesData') {
                continue;
            }
            var section = dataViewData[key];
            if (!section || !section.options) {
                continue;
            }
            html += this._renderSubSection(key, section, dataViewData);
        }
        html += DVHelper.closeUL();
    }

    html += DVHelper.closeLI();
    html += DVHelper.closeUL();

    html += '</div>'; // .recorder-section

    return html;
};

/**
 * Render a sub-section (e.g., "own", "inherited0") from DataView-formatted data.
 * @param {string} key
 * @param {Object} section - { data, options, types, associations }
 * @param {Object} parentData - the full dataViewData for isPropertiesData check
 * @returns {string}
 * @private
 */
InspectorRecorder.prototype._renderSubSection = function (key, section, parentData) {
    var html = '';
    var options = section.options;
    var data = section.data;

    html += DVHelper.openLI();

    // Section title with arrow
    if (options.title) {
        if (DVHelper.getObjectLength(data)) {
            html += DVHelper.addArrow(false);
        }
        html += DVHelper.wrapInTag('section-title', options.title);
    }

    if (data && DVHelper.getObjectLength(data)) {
        html += DVHelper.openUL({ expandable: 'true' });

        var keys = Array.isArray(data) ? Object.keys(data) : sortKeysAlphabetically(Object.keys(data));

        for (var i = 0; i < keys.length; i++) {
            var propKey = keys[i];
            var currentElement = data[propKey];

            html += DVHelper.openLI();

            if (currentElement && currentElement.options) {
                // Nested object with its own options — recurse
                html += this._renderSubSection(propKey, currentElement, parentData);
            } else if (currentElement && currentElement._isClickableValueForDataView) {
                // Clickable value
                html += DVHelper.wrapInTag('key', propKey) + ':&nbsp;' + DVHelper.wrapInTag('value', currentElement.value);
            } else {
                // Simple key-value pair
                var vValue;
                if (parentData && parentData.isPropertiesData) {
                    var propInfo = currentElement;
                    vValue = propInfo ? propInfo.value : currentElement;
                } else {
                    vValue = currentElement;
                }

                if (vValue && typeof vValue === 'object') {
                    html += DVHelper.wrapInTag('key', propKey) + ':&nbsp;' + DVHelper.wrapInTag('value', JSON.stringify(vValue));
                } else {
                    var valueHtml = DVHelper.wrapInTag('value', vValue);
                    valueHtml = DVHelper.valueNeedsQuotes(vValue, valueHtml);
                    html += DVHelper.wrapInTag('key', propKey) + ':&nbsp;' + valueHtml;
                }
            }

            html += DVHelper.closeLI();
        }

        // Associations
        if (section.associations) {
            var assocKeys = sortKeysAlphabetically(Object.keys(section.associations));
            for (var j = 0; j < assocKeys.length; j++) {
                var name = assocKeys[j];
                html += DVHelper.openLI();
                html += DVHelper.wrapInTag('key', name) + ':&nbsp;' + DVHelper.wrapInTag('value', section.associations[name]);
                html += DVHelper.closeLI();
            }
        }

        html += DVHelper.closeUL();
    } else if (!options.hideTitle) {
        html += DVHelper.openUL({ expanded: 'true' });
        html += DVHelper.openLI();
        html += DVHelper.wrapInTag('no-data', 'No Available Data');
        html += DVHelper.closeLI();
        html += DVHelper.closeUL();
    }

    html += DVHelper.closeLI();

    return html;
};

/**
 * Render the simplified control tree section for an entry. The tree data is
 * scoped to the recorded control (its ancestors and siblings) via
 * _simplifyControlTreeDataWithControlId. Rendered as the last section in the
 * entry body.
 * @param {string} title
 * @param {Object} treeData - { versionInfo, controls: [{ id, name, type, content }] }
 * @param {string} recordedControlId - id of the recorded control, highlighted in the tree
 * @returns {string}
 * @private
 */
InspectorRecorder.prototype._renderControlTreeSection = function (title, treeData, recordedControlId) {
    var html = '';

    html += '<div class="recorder-section recorder-tree-section">';

    html += DVHelper.openUL({ expandable: 'true' });
    html += DVHelper.openLI();

    var hasControls = treeData && Array.isArray(treeData.controls) && treeData.controls.length > 0;
    if (hasControls) {
        html += DVHelper.addArrow(false);
    }
    html += DVHelper.wrapInTag('section-title', title);

    if (!hasControls) {
        html += DVHelper.openUL({ expanded: 'true' });
        html += DVHelper.openLI();
        html += DVHelper.wrapInTag('no-data', 'No Available Data');
        html += DVHelper.closeLI();
        html += DVHelper.closeUL();
    } else {
        html += this._renderControlTreeNodes(treeData.controls, recordedControlId);
    }

    html += DVHelper.closeLI();
    html += DVHelper.closeUL();

    html += '</div>'; // .recorder-tree-section

    return html;
};

/**
 * Recursively render control tree nodes as a nested collapsible list.
 * @param {Array} controls - array of { id, name, type, content }
 * @param {string} recordedControlId - id to highlight
 * @returns {string}
 * @private
 */
InspectorRecorder.prototype._renderControlTreeNodes = function (controls, recordedControlId) {
    if (!Array.isArray(controls) || controls.length === 0) {
        return '';
    }

    var html = DVHelper.openUL({ expandable: 'true' });

    for (var i = 0; i < controls.length; i++) {
        var node = controls[i];
        var hasChildren = Array.isArray(node.content) && node.content.length > 0;
        var isRecorded = node.id === recordedControlId;

        html += DVHelper.openLI();

        if (hasChildren) {
            html += DVHelper.addArrow(false);
        }

        var nodeName = node.name || 'Control';
        var label = '&#60;' + _escapeHtml(nodeName) +
            ' id="' + _escapeHtml(node.id) + '"&#62;';
        var attributes = isRecorded ? { class: 'recorder-tree-node-recorded' } : undefined;
        html += DVHelper.wrapInTag('tree-node', label, attributes);

        if (hasChildren) {
            html += this._renderControlTreeNodes(node.content, recordedControlId);
        }

        html += DVHelper.closeLI();
    }

    html += DVHelper.closeUL();

    return html;
};

/**
 * Check if DataView-formatted data is empty.
 * @param {Object} viewObjects
 * @returns {boolean}
 * @private
 */
InspectorRecorder.prototype._isDataEmpty = function (viewObjects) {
    for (var key in viewObjects) {
        if (key === 'isPropertiesData') {
            continue;
        }
        if (viewObjects[key] && viewObjects[key].data && DVHelper.getObjectLength(viewObjects[key].data)) {
            return false;
        }
    }
    return true;
};

/**
 * Click event handler for expand/collapse and Clear All.
 * @private
 */
InspectorRecorder.prototype._onClickHandler = function () {
    var that = this;

    this._container.addEventListener('click', function (event) {
        var target = event.target;

        // Record / Stop Recording button
        var recordBtn = target.closest('.recorder-record-btn');
        if (recordBtn) {
            that._isRecording = !that._isRecording;
            that._render();
            that._onToggleRecording(that._isRecording);
            return;
        }

        // Clear All button
        if (target.classList.contains('recorder-clear-btn')) {
            that.clear();
            return;
        }

        // Entry header expand/collapse
        var entryHeader = target.closest('.recorder-entry-header');
        if (entryHeader) {
            var entryBody = entryHeader.nextElementSibling;
            if (entryBody && entryBody.classList.contains('recorder-entry-body')) {
                var arrow = entryHeader.querySelector('arrow');
                if (entryBody.hidden) {
                    entryBody.hidden = false;
                    if (arrow) {
                        arrow.removeAttribute('right');
                        arrow.setAttribute('down', 'true');
                    }
                } else {
                    entryBody.hidden = true;
                    if (arrow) {
                        arrow.removeAttribute('down');
                        arrow.setAttribute('right', 'true');
                    }
                }
            }
            return;
        }

        // Sub-section expand/collapse (DataView-style arrow toggle)
        var li = target.closest('li');
        if (li) {
            DVHelper.toggleCollapse(li);
        }
    });
};

module.exports = InspectorRecorder;
