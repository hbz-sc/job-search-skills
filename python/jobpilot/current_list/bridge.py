from ..bridge import BossBridge
from ..errors import WorkflowError
from .logging import error_code


class CurrentListBridge(BossBridge):
    schema_file="boss-current-list-v4.schema.json"
    capability_field="currentListVersion"
    hash_field="currentListSchemaHash"

    def _execute(self, tool, payload, version=4, *, request_id=None):
        return super()._execute(tool,payload,version,request_id=request_id)

    def _read_result(self, request_id, result, *, adopt=True):
        if isinstance(result,dict) and result.get("requestId")==request_id and result.get("phase")!="observed":
            if self.ledger: self.ledger.after_action(request_id,result)
            raise WorkflowError(error_code(result.get("error",{}).get("code")) if result.get("error") else "ACTION_UNKNOWN")
        return super()._read_result(request_id,result,adopt=adopt)

    def start_current(self, mode, batch_id, remaining):
        if self.started: raise WorkflowError("RUN_ALREADY_STARTED")
        self._execute("start_run",{"mode":mode,"batchId":batch_id,"maxContacts":remaining if mode=="run" else 0})
        self.started=True
