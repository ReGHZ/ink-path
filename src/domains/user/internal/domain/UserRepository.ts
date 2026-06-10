import type { User } from "./User.js";


export type UserRepository = {

  findById(id: string): Promise<User | null>;

  findByEmail(email: string): Promise<User | null>;

  findByUsername(username: string): Promise<User | null>

  insert(user: User): Promise<void>;

  update(user: User): Promise<void>;
}
