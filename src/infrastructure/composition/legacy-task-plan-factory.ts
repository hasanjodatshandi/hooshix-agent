import { randomUUID } from "node:crypto";
import type { TaskPlan, TaskStep } from "../../application/dto/legacy-task-plan.js";
import { validateTaskPlan } from "../../application/services/legacy-task-plan-validator.js";

export function createTaskPlan(
  task: string,
  steps?: Array<Omit<TaskStep,"id"|"status"> & Partial<Pick<TaskStep,"id"|"status">>>,
  description?: string,
): TaskPlan {
  return validateTaskPlan({
    id: randomUUID(),
    task,
    description,
    state: "created",
    steps: steps?.map((step,index)=>({...step,id:step.id ?? index+1,status:step.status ?? "pending"})) ?? [
      {id:1,action:"inspect project",tool:"list_directory",arguments:{path:"."},status:"pending"},
      {id:2,action:"inspect implementation markers",tool:"search_files",arguments:{path:".",query:"TODO"},status:"pending"},
      {id:3,action:"verify runtime",tool:"execute_command",arguments:{command:"node",args:["--version"]},status:"pending"},
    ],
  });
}
