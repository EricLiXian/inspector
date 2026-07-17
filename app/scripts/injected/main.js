sap.ui.require(['ToolsAPI'], function (ToolsAPI) {
    'use strict';

    var ui5inspector = require('../modules/injected/ui5inspector.js');
    var message = require('../modules/injected/message.js');
    var controlUtils = require('../modules/injected/controlUtils.js');
    var rightClickHandler = require('../modules/injected/rightClickHandler.js');
    var applicationUtils = require('../modules/injected/applicationUtils');

    var ui5TempName = 'ui5$temp';
	var ui5Temp = window[ui5TempName] = {}; // Container for all temp. variables
	var tempVarCount = 0;

    // Recording state — controlled from the devtools panel. When true, left-clicks
    // on UI5 controls in the page are captured into the Inspector Recorder.
    var _isRecording = false;

    const log = (m, options) => console.log(`ui5-inspector: ${m}`, options ? options : false);

    // Create global reference for the extension.
    ui5inspector.createReferences();

    /**
     * Mutation observer for DOM elements
     * @type {{init: Function, _observer: MutationObserver, _options: {subtree: boolean, childList: boolean, attributes: boolean}}}
     */
    var mutation = {

        /**
         * Initialize the observer.
         */
        init: function () {
            this._observer.observe(document.body, this._options);
        },

        /**
         * Create an observer instance.
         */
        _observer: new MutationObserver(function (mutations) {
            var isMutationValid = true;
            var controlTreeModel;
            var commonInformation;

            mutations.forEach(function (mutation) {
                if (mutation.target.id === 'ui5-highlighter' || mutation.target.id === 'ui5-highlighter-container') {
                    isMutationValid = false;
                    return;
                }
            });

            if (isMutationValid === true) {
                controlTreeModel = ToolsAPI.getRenderedControlTree();
                ToolsAPI.getFrameworkInformation().then(function(frameworkInformation) {
                    commonInformation = frameworkInformation.commonInformation;
                    message.send({
                        action: 'on-application-dom-update',
                        controlTree: controlUtils.getControlTreeModel(controlTreeModel, commonInformation)
                    });
                });
            }
        }),

        // Configuration of the observer
        _options: {
            subtree: true,
            childList: true,
            // If this is set to true, some controls will trigger mutation(example: newsTile changing active tile)
            attributes: false
        }
    };

    // Initialize
    mutation.init();

    /**
     * Sets control's property.
     * @param {Object} oControl
     * @param {Object} oData - property's data
     * @private
     */
    function _setControlProperties (oControl, oData) {
        var sProperty = oData.property;
        var oNewValue = oData.value;

        try {
            // Change the property through its setter
            oControl['set' + sProperty](oNewValue);
        } catch (error) {
            console.warn(error);
        }
    }

    /**
     * Build the same formatted control data that 'do-control-select' sends, so the
     * recorder can create an entry without triggering a separate control selection.
     * @param {string} controlId
     * @returns {Object}
     */
    function _getRecorderControlData(controlId) {
        var controlProperties = ToolsAPI.getControlProperties(controlId);
        var controlBindings = ToolsAPI.getControlBindings(controlId);
        return {
            controlProperties: controlUtils.getControlPropertiesFormattedForDataView(controlId, controlProperties),
            controlBindings: controlUtils.getControlBindingsFormattedForDataView(controlBindings)
        };
    }

    /**
     * Walk up the DOM from the given element to the closest UI5 control id.
     * @param {Element} element
     * @returns {string|null}
     */
    function _findClosestUI5ControlId(element) {
        var node = element;
        while (node && node !== document.body) {
            if (node.getAttribute && node.getAttribute('data-sap-ui')) {
                return node.id || null;
            }
            node = node.parentNode;
        }
        return null;
    }

    /**
     * Track the most recently focused editable native element and its value at focus
     * time, so that on commit (change or blur) we can decide whether the user typed
     * something and emit a recorder entry.
     */
    var _focusedEditable = null;
    var _focusedEditableInitialValue = null;
    var _focusedEditableControlId = null;

    /**
     * @param {Element} element
     * @returns {boolean}
     */
    function _isEditableTextElement(element) {
        if (!element || !element.tagName) {
            return false;
        }
        var tag = element.tagName;
        if (tag === 'TEXTAREA') {
            return true;
        }
        if (tag === 'INPUT') {
            var type = (element.getAttribute('type') || 'text').toLowerCase();
            // Skip checkboxes, radios, buttons, file pickers, etc.
            return type !== 'checkbox' && type !== 'radio' && type !== 'button' &&
                type !== 'submit' && type !== 'reset' && type !== 'file' &&
                type !== 'image' && type !== 'hidden';
        }
        if (element.isContentEditable) {
            return true;
        }
        return false;
    }

    /**
     * @param {Element} element
     * @returns {string}
     */
    function _readEditableValue(element) {
        if (!element) {
            return '';
        }
        if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
            return element.value === null ? '' : String(element.value);
        }
        if (element.isContentEditable) {
            return element.textContent === null ? '' : String(element.textContent);
        }
        return '';
    }

    /**
     * Emit a recorder text-capture message for the currently focused field if its
     * value changed since focus. After committing, re-arm tracking with the new
     * value as the baseline so subsequent edits before blur are also captured.
     */
    function _commitFocusedEditable() {
        if (!_focusedEditable || !_focusedEditableControlId) {
            _focusedEditable = null;
            _focusedEditableInitialValue = null;
            _focusedEditableControlId = null;
            return;
        }
        var currentValue = _readEditableValue(_focusedEditable);
        if (currentValue !== _focusedEditableInitialValue) {
            message.send(Object.assign({
                action: 'on-recorder-text-capture',
                target: _focusedEditableControlId,
                value: currentValue
            }, _getRecorderControlData(_focusedEditableControlId)));
            _focusedEditableInitialValue = currentValue;
        }
    }

    /**
     * Stop tracking the currently focused editable.
     */
    function _clearFocusedEditable() {
        _focusedEditable = null;
        _focusedEditableInitialValue = null;
        _focusedEditableControlId = null;
    }

    // Name space for message handler functions.
    var messageHandler = {

        /**
         * Send message with the needed initial information for the extension.
         */
        'get-initial-information': function () {
            var controlTreeModel = ToolsAPI.getRenderedControlTree();
            ToolsAPI.getFrameworkInformation().then(function(frameworkInformation) {
                message.send({
                    action: 'on-receiving-initial-data',
                    applicationInformation: applicationUtils.getApplicationInfo(frameworkInformation),
                    controlTree: controlUtils.getControlTreeModel(controlTreeModel, frameworkInformation.commonInformation),
                    elementRegistry: ToolsAPI.getRegisteredElements()
                });
            });
        },

        /**
         * Send framework information.
         */
        'get-framework-information': function () {
            ToolsAPI.getFrameworkInformation().then(function(frameworkInformation) {
                message.send({
                    action: 'on-framework-information',
                    frameworkInformation: applicationUtils.getInformationForPopUp(frameworkInformation)
                });
            });
        },

        /**
         * Handler for logging event listener fucntion.
         * @param {Object} event
         */
        'do-console-log-event-listener': function (event) {
            var evtData = event.detail.data;
            console.log(controlUtils.getElementById(evtData.controlId).mEventRegistry[evtData.eventName][evtData.listenerIndex].fFunction);
        },

        /**
         * Handler for element selection in the ControlTree.
         * @param {Object} event
         */
        'do-control-select': function (event) {
            var controlId = event.detail.target;
            var control = controlUtils.getElementById(controlId);

            if (ToolsAPI._lastSelectedControl !== control) {
                ToolsAPI.removeEventListeners(ToolsAPI._lastSelectedControl);
                ToolsAPI._lastSelectedControl = control;
                ToolsAPI.attachEventListeners(control);
            }

            if (control) {
                var controlProperties = ToolsAPI.getControlProperties(controlId);
                var controlBindings = ToolsAPI.getControlBindings(controlId);
                var controlAggregations = ToolsAPI.getControlAggregations(controlId);
                var controlEvents = ToolsAPI.getControlEvents(controlId);

                message.send({
                    action: 'on-control-select',
                    controlProperties: controlUtils.getControlPropertiesFormattedForDataView(controlId, controlProperties),
                    controlBindings: controlUtils.getControlBindingsFormattedForDataView(controlBindings),
                    controlAggregations: controlUtils.getControlAggregationsFormattedForDataView(controlId, controlAggregations),
                    controlEvents: controlUtils.getControlEventsFormattedForDataView(controlId, controlEvents),
                    controlActions: controlUtils.getControlActionsFormattedForDataView(controlId)
                });
            }
        },

        /**
         * Updates the fired events section.
         * @param {Object} event
         */
        'do-event-fired': function (event) {
            var controlId = event.detail.controlId;
            var controlEvents = ToolsAPI.getControlEvents(controlId);

            message.send({
                action: 'on-event-update',
                controlEvents: controlUtils.getControlEventsFormattedForDataView(controlId, controlEvents)
            });
        },

        /**
         * Handler for element selection in the Elements Registry.
         * @param {Object} event
         */
        'do-control-select-elements-registry': function (event) {
            var controlId = event.detail.target;
            var controlProperties = ToolsAPI.getControlProperties(controlId);
            var controlBindings = ToolsAPI.getControlBindings(controlId);
            var controlAggregations = ToolsAPI.getControlAggregations(controlId);
            var controlEvents = ToolsAPI.getControlEvents(controlId);

            message.send({
                action: 'on-control-select-elements-registry',
                controlProperties: controlUtils.getControlPropertiesFormattedForDataView(controlId, controlProperties),
                controlBindings: controlUtils.getControlBindingsFormattedForDataView(controlBindings),
                controlAggregations: controlUtils.getControlAggregationsFormattedForDataView(controlId, controlAggregations),
                controlEvents: controlUtils.getControlEventsFormattedForDataView(controlId, controlEvents)
            });
        },

        /**
         * Handler for refreshing elements in Elements Registry.
         */
        'do-elements-registry-refresh': function () {
            message.send({
                action: 'on-receiving-elements-registry-refresh-data',
                elementRegistry: ToolsAPI.getRegisteredElements()
            });
        },

        /**
         * Send message with the inspected UI5 control, from the context menu.
         * @param {Object} event
         */
        'select-control-tree-element-event': function (event) {
            var portMessage = event.detail;

            message.send({
                action: 'on-contextMenu-control-select',
                target: portMessage.target,
                frameId: event.detail.frameId
            });
        },

        /**
         * Change control property, based on editing in the DataView.
         * @param {Object} event
         */
        'do-control-property-change': function (event) {
            var oData = event.detail.data;
            var sControlId = oData.controlId;
            var oControl = controlUtils.getElementById(sControlId);

            if (!oControl) {
                return;
            }

            _setControlProperties(oControl, oData);

            // Update the DevTools with the actual property value of the control
            this['do-control-select']({
                detail: {
                    target: sControlId
                }
            });
        },

        'do-control-invalidate': function (event) {
            var oData = event.detail.data;
            var sControlId = oData.controlId;
            var oControl = controlUtils.getElementById(sControlId);

            if (!oControl) {
                return;
            }

            oControl.invalidate();

            // Update the DevTools with the actual property value of the control
            this['do-control-select']({
                detail: {
                    target: sControlId
                }
            });
        },

        'do-control-focus': function (event) {
            var oData = event.detail.data;
            var sControlId = oData.controlId;
            var oControl = controlUtils.getElementById(sControlId);

            if (!oControl) {
                return;
            }

            oControl.focus();

        },

        /**
         * Change control property, based on editing in the DataView.
         * @param {Object} event
         */
        'do-control-property-change-elements-registry': function (event) {
            var oData = event.detail.data;
            var sControlId = oData.controlId;
            var oControl = controlUtils.getElementById(sControlId);

            if (!oControl) {
                return;
            }

            _setControlProperties(oControl, oData);

            // Update the DevTools with the actual property value of the control
            this['do-control-select-elements-registry']({
                detail: {
                    target: sControlId
                }
            });
        },

        /**
         * Selects Control with context menu click.
         * @param {Object} event
         */
        'do-context-menu-control-select': function (event) {
            message.send({
                action: 'on-contextMenu-control-select',
                target: event.detail.target,
                frameId: event.detail.frameId
            });
        },

        /**
         * Toggle click-to-record mode from the devtools panel.
         * @param {Object} event
         */
        'do-set-recording-state': function (event) {
            _isRecording = !!event.detail.isRecording;
        },

        /**
         * Copies HTML of Control to Console.
         * @param {Object} event
         */
         'do-control-copy-html': function (event) {
            var elementID = event.detail.target;
            var selectedElement;

            if (typeof elementID !== 'string') {
                console.warn('Please use a valid string parameter');
                return;
            }

            selectedElement = document.getElementById(elementID);
            log('\n' + '%cCopy HTML ⬇️', 'color:#12b1eb; font-size:12px');
            console.log(selectedElement);

        },

        /**
         * Clears the logged fired events.
         * @param {Object} event
         */
        'do-control-clear-events': function (event) {
            var controlId = event.detail.target;
            var clearedEvents = ToolsAPI.clearEvents(controlId);

            if (clearedEvents) {
                message.send({
                    action: 'on-event-update',
                    controlEvents: controlUtils.getControlEventsFormattedForDataView(controlId, clearedEvents),
                });
            }

        },

        /**
         * Handler to copy the element into a temp variable on the console
         * @param {Object} event
         */
        'do-copy-control-to-console': function (event) {
            var oData = event.detail.data;
            var sControlId = oData.controlId;
            const control = controlUtils.getElementById(sControlId);
            if (control) {
                try {
                    const tempVarName = ui5Temp[sControlId] && ui5Temp[sControlId].savedAs || `ui5$${tempVarCount++}`;
                    const instance = window[tempVarName] = ui5Temp[sControlId] = {
                        control: control,
                        isA: control.getMetadata().getName(),
                        savedAs: tempVarName
                    };

                    log(`Control copied to global var ${tempVarName}, all vars are collected in global var ${ui5TempName}`);
                    console.log(instance);
                } catch (exc) {
                    // Ignore errors gracefully
                }
            } else {
                log(`No Control with id ${sControlId} exists`);
            }
        }
    };

    /**
     * Register mousedown event.
     */
    ui5inspector.registerEventListener('mousedown', function rightClickTarget(event) {
        if (event.button === 2) {
            rightClickHandler.setClickedElementId(event.target);
            message.send({
                action: 'on-right-click',
                target: rightClickHandler.getClickedElementId()
            });
            return;
        }

        // When recording is on, a left-click on a UI5 control should be recorded

        if (!_isRecording || event.button !== 0) {
            return;
        }
        // If the click lands on an editable element, suppress the click entry —
        // any typing will produce a dedicated "Typed" entry on commit.
        if (_isEditableTextElement(event.target)) {
            return;
        }
        // mousedown fires before the input's focusout, so a pending typing edit
        // would otherwise be committed after this click. Flush it first to keep
        // the recorded order correct (type before click).
        if (_focusedEditable && _focusedEditable !== event.target) {
            _commitFocusedEditable();
            _clearFocusedEditable();
        }
        var controlId = _findClosestUI5ControlId(event.target);
        if (!controlId) {
            return;
        }
        message.send(Object.assign({
            action: 'on-recorder-click-capture',
            target: controlId
        }, _getRecorderControlData(controlId)));
    });


    // ui5inspector.registerEventListener('click', function recorderClickCapture(event) {
    //     // When recording is on, a left-click on a UI5 control should be recorded

    //     if (!_isRecording || event.button !== 0) {
    //         return;
    //     }
    //     // If the click lands on an editable element, suppress the click entry —
    //     // any typing will produce a dedicated "Typed" entry on commit.
    //     if (_isEditableTextElement(event.target)) {
    //         return;
    //     }
    //     var controlId = _findClosestUI5ControlId(event.target);
    //     if (!controlId) {
    //         return;
    //     }
    //     message.send(Object.assign({
    //         action: 'on-recorder-click-capture',
    //         target: controlId
    //     }, _getRecorderControlData(controlId)));
    // });

    ui5inspector.registerEventListener('focusin', function recorderFocusIn(event) {
        if (!_isRecording) {
            return;
        }
        // If focus moved without firing a commit (rare), flush prior state first.
        if (_focusedEditable && _focusedEditable !== event.target) {
            _commitFocusedEditable();
            _clearFocusedEditable();
        }
        if (!_isEditableTextElement(event.target)) {
            return;
        }
        var controlId = _findClosestUI5ControlId(event.target);
        if (!controlId) {
            return;
        }
        _focusedEditable = event.target;
        _focusedEditableInitialValue = _readEditableValue(event.target);
        _focusedEditableControlId = controlId;
    });

    ui5inspector.registerEventListener('focusout', function recorderFocusOut(event) {
        if (event.target !== _focusedEditable) {
            return;
        }
        _commitFocusedEditable();
        _clearFocusedEditable();
    });

    ui5inspector.registerEventListener('change', function recorderChange(event) {
        if (event.target !== _focusedEditable) {
            return;
        }
        // Commit but keep tracking — the field may still have focus and further
        // edits before blur should also be captured.
        _commitFocusedEditable();
    });

    /**
     * Register custom event for communication with the injected.
     */
    ui5inspector.registerEventListener('ui5-communication-with-injected-script', function communicationWithContentScript(event) {
        var action = event.detail.action;

        if (messageHandler[action]) {
            messageHandler[action](event);
        }
    });
});
