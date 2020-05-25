import { Component, OnInit } from '@angular/core';
import { Router } from "@angular/router";
import { LoginService} from "../login.service";

@Component({
  selector: 'app-main-menu',
  templateUrl: './main-menu.component.html',
  styleUrls: ['./main-menu.component.css']
})
export class MainMenuComponent implements OnInit {

  constructor(
    private router: Router,
    private loginService: LoginService
    ) { }

  ngOnInit(): void {
  }

  onProductsClick() {
    this.router.navigate(['products'])
  }

  onLogoutClick() {
    this.loginService.logout()
  }
}
