import { Component, OnInit } from '@angular/core';
import { environment } from './../../environments/environment';
import { LocalStorageService } from '../local-storage.service';


@Component({
  selector: 'app-top-bar',
  templateUrl: './app-top-bar.component.html',
  styleUrls: ['./app-top-bar.component.css']
})
export class AppTopBarComponent implements OnInit {
  env = environment;

  constructor(
    private storage: LocalStorageService
  ) { }

  shouldShowMainMenuNavigation = false
  ngOnInit(): void {
    alert(this.storage.locallyStoredToken())
    if (this.storage.locallyStoredToken()) {
      this.shouldShowMainMenuNavigation = true
    } else {
      this.shouldShowMainMenuNavigation = false
    }
  }
}
