import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { RegisterNewUserComponent } from './register-new-user/register-new-user.component';
import { LoginComponent } from './login/login.component';
import { UserProfileComponent} from './user-profile/user-profile.component';
import { MainMenuComponent } from './main-menu/main-menu.component';
import { ProductsComponent } from './products/products.component';
import { AddNewProductComponent } from './add-new-product/add-new-product.component';
import { FilesComponent } from './files/files.component';


const routes: Routes = [
  { path: 'register', component: RegisterNewUserComponent },
  { path: 'login', component: LoginComponent },
  { path: 'users/:userId', component: UserProfileComponent},
  { path: 'main-menu', component: MainMenuComponent},
  { path: 'products', component: ProductsComponent},
  { path: 'products/add-new-product', component: AddNewProductComponent},
  { path: 'products/edit/:productId', component: AddNewProductComponent},
  { path: 'files/add', component: FilesComponent }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
