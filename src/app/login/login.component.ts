import { Component, OnInit } from '@angular/core';
import { environment } from './../../environments/environment';
import { LoginService } from '../login.service';
import { Router } from "@angular/router";
import { FormBuilder, Validators, FormControl } from '@angular/forms';
import { LocalStorageService } from '../local-storage.service';



@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent implements OnInit {
  loginForm;

  constructor(private loginService: LoginService,
              private router: Router,
              private formBuilder: FormBuilder,
              private localStorageService: LocalStorageService
              ) {
                this.loginForm = this.formBuilder.group({
                  email: new FormControl('', [Validators.required, Validators.pattern("^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,4}$")]),
                  password: ['', Validators.required],
                });
               }
  error;
  registerForm;
  environment = environment;

  ngOnInit(): void {
  }

  onSuccessfulLogin(login_response) {
    var api_token: String = login_response['api_token']
    var user = login_response['user']
    var user_id = user['id']

    this.localStorageService.setTokenLocally(api_token);
    this.localStorageService.setLoggedInUserId(user_id);

    this.error = 'users/' + user_id

    this.router.navigate(['users/' + user_id]);
  }

  onSubmit(customerData) {

    this.loginService.loginObservable(customerData).then( 
      res => {
      this.onSuccessfulLogin(res);
    },
    msg => {
      this.error = JSON.stringify(msg)
    }
    )
  }

  onRegisterClick() {
    this.router.navigate(['register'])
  }
}
