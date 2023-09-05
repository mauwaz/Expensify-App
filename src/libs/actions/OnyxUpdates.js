import Onyx from 'react-native-onyx';
import ONYXKEYS from '../../ONYXKEYS';
import * as QueuedOnyxUpdates from './QueuedOnyxUpdates'


/**
 * @param {Object} data
 * @param {Object} data.request
 * @param {Object} data.responseData
 * @returns {Promise}
 */
function applyHTTPSOnyxUpdates({request, responseData}) {
    console.debug('[OnyxUpdateManager] Applying https update');
    // For most requests we can immediately update Onyx. For write requests we queue the updates and apply them after the sequential queue has flushed to prevent a replay effect in
    // the UI. See https://github.com/Expensify/App/issues/12775 for more info.
    const updateHandler = request.data.apiRequestType === CONST.API_REQUEST_TYPE.WRITE ? QueuedOnyxUpdates.queueOnyxUpdates : Onyx.update;

    // First apply any onyx data updates that are being sent back from the API. We wait for this to complete and then
    // apply successData or failureData. This ensures that we do not update any pending, loading, or other UI states contained
    // in successData/failureData until after the component has received and API data.
    const onyxDataUpdatePromise = responseData.onyxData ? updateHandler(responseData.onyxData) : Promise.resolve();

    return onyxDataUpdatePromise
        .then(() => {
            // Handle the request's success/failure data (client-side data)
            if (responseData.jsonCode === 200 && request.successData) {
                return updateHandler(request.successData);
            }
            if (responseData.jsonCode !== 200 && request.failureData) {
                return updateHandler(request.failureData);
            }
            return Promise.resolve();
        })
        .then(() => {
            console.debug('[OnyxUpdateManager] Done applying HTTPS update');
        });
}

/**
 * @param {Object} data
 * @param {Object} data.updates
 * @returns {Promise}
 */
function applyPusherOnyxUpdates({updates}) {
    console.debug('[OnyxUpdateManager] Applying pusher update');
    const pusherEventPromises = _.reduce(
        updates,
        (result, update) => {
            result.push(PusherUtils.triggerMultiEventHandler(update.eventType, update.data));
            return result;
        },
        [],
    );
    return Promise.all(pusherEventPromises).then(() => {
        console.debug('[OnyxUpdateManager] Done applying Pusher update');
    });
}

/**
 * @param {Object[]} updateParams
 * @param {String} updateParams.type
 * @param {Object} updateParams.data
 * @param {Object} [updateParams.data.request] Exists if updateParams.type === 'https'
 * @param {Object} [updateParams.data.response] Exists if updateParams.type === 'https'
 * @param {Object} [updateParams.data.updates] Exists if updateParams.type === 'pusher'
 * @returns {Promise}
 */
function applyOnyxUpdates({type, data}) {
    console.debug(`[OnyxUpdateManager] Applying update type: ${type}`, data);
    if (type === CONST.ONYX_UPDATE_TYPES.HTTPS) {
        return applyHTTPSOnyxUpdates(data);
    }
    if (type === CONST.ONYX_UPDATE_TYPES.PUSHER) {
        return applyPusherOnyxUpdates(data);
    }
}

/**
 * @param {Object[]} updateParams
 * @param {String} updateParams.type
 * @param {Object} updateParams.data
 * @param {Object} [updateParams.data.request] Exists if updateParams.type === 'https'
 * @param {Object} [updateParams.data.responseData] Exists if updateParams.type === 'https'
 * @param {Object} [updateParams.data.updates] Exists if updateParams.type === 'pusher'
 * @param {Number} [lastUpdateID]
 * @param {Number} [previousUpdateID]
 */
function saveUpdateInformation(updateParams, lastUpdateID = 0, previousUpdateID = 0) {
    // Always use set() here so that the updateParams are never merged and always unique to the request that came in
    Onyx.set(ONYXKEYS.ONYX_UPDATES_FROM_SERVER, {
        lastUpdateIDFromServer: lastUpdateID,
        previousUpdateIDFromServer: previousUpdateID,
        updateParams,
    });
}

// This key needs to be separate from ONYXKEYS.ONYX_UPDATES_FROM_SERVER so that it can be updated without triggering the callback when the server IDs are updated
let lastUpdateIDAppliedToClient = 0;
Onyx.connect({
    key: ONYXKEYS.ONYX_UPDATES_LAST_UPDATE_ID_APPLIED_TO_CLIENT,
    callback: (val) => (lastUpdateIDAppliedToClient = val),
});


function needsToUpdateClient(previousUpdateID = 0) {
    
    // If no previousUpdateID is sent, this is not a WRITE request so we don't need to update our current state
    if(!previousUpdateID) {
        return false;
    }
    
    // If we don't have any value in lastUpdateIDAppliedToClient, this is the first time we're receiving anything, so we need to do a last reconnectApp
    if(!lastUpdateIDAppliedToClient) {
        return true;
    }

    return lastUpdateIDAppliedToClient < previousUpdateID;
}

// eslint-disable-next-line import/prefer-default-export
export {saveUpdateInformation, needsToUpdateClient, applyOnyxUpdates};
