






import { Component, OnInit } from '@angular/core';
import { FormBuilder, Validators, FormControl } from '@angular/forms';
import { ApiRequestService } from '../api-request.service';
import { LoginService} from '../login.service';
import { Router } from "@angular/router";



@Component({
  selector: 'app-register-new-user',
  templateUrl: './register-new-user.component.html',
  styleUrls: ['./register-new-user.component.css']
})
export class RegisterNewUserComponent implements OnInit {
  registerForm;

  constructor(
    private formBuilder: FormBuilder,
    private apiService: ApiRequestService,
    private router: Router
  ) {
    this.registerForm = this.formBuilder.group({
      name: ['', Validators.required],
      email: new FormControl('', [Validators.required, Validators.pattern("^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,4}$")]),
      password: ['', Validators.required],
      password_confirmation: ['', Validators.required]
    });
  }

  isFormStatusValid() {
    return this.registerForm.status == 'INVALID'
  }

  ngOnInit() {

  }

  // To convert json to string
  // JSON.stringify(res)
  error;
  newUser;
  onSubmit(customerData) {
    // Process checkout data here
    this.registerForm.reset();
    this.apiService.dispatchPostRequest("/register", customerData, false).then(res =>{
      this.router.navigate(['login']);
    }, msg => {
      this.error = JSON.stringify(msg)
    })
  }
}