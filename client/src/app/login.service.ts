import { Injectable } from '@angular/core';
import { ApiRequestService } from './api-request.service';
import { LocalStorageService } from './local-storage.service';
import { Router } from "@angular/router";


@Injectable({
  providedIn: 'root'
})
export class LoginService {

  constructor(
    private apiService: ApiRequestService,
    private cookie: LocalStorageService,
    private router: Router
    ) { }

  loginObservable(user) {
    return this.apiService.dispatchPostRequest("/login", user, false)
  }

  logout() {
    this.cookie.resetLocalStorage();
    this.router.navigate(['login']);
  }

  // This is usually called when user is in a suituation where not suppoed 
  // to be seeing the page and initiates a process.
  // upon this the user is alereted and immediately refered to the login page.
  onAuthError() {
    this.logout()
    this.router.navigate(['login'])
  }
}
