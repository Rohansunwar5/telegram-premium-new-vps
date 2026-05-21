import AdminModel, { IAdmin } from '../models/admin.model';

export class AdminRepository {
  async findByEmail(email: string): Promise<IAdmin | null> {
    return AdminModel.findOne({ email });
  }

  async findById(id: string): Promise<IAdmin | null> {
    return AdminModel.findById(id);
  }

  async create(params: { email: string; password: string }): Promise<IAdmin> {
    return AdminModel.create(params);
  }
}
