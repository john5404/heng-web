import { requireUser } from "./auth";

/** Anonymous and invalid sessions go to login. A signed-in user lands on the floor. */
export async function homeDestination(request: Request): Promise<"/login" | "/floor"> {
  const user = await requireUser(request);
  return user instanceof Response ? "/login" : "/floor";
}
