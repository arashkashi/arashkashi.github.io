import { Component, OnInit } from '@angular/core';
import { Router } from "@angular/router";
import { ApiRequestService } from '../api-request.service';



@Component({
  selector: 'app-products',
  templateUrl: './products.component.html',
  styleUrls: ['./products.component.css']
})
export class ProductsComponent implements OnInit {
  products;
  error;

  constructor(
    private router: Router,
    private api: ApiRequestService
  ) { }

  ngOnInit(): void {
    this.onRefreshClick()
  }

  onAllProducts(products) {

    this.products = products;
  }

  listSortedPropertyKeyValues(product) {
    var json = JSON.parse(product['properties']);
    const keys = Object.keys(json).sort((one, two) => (one > two ? 1 : -1)); 
    var result: Array<[String, String]> = []
    for (let key of keys) {
      result.push([key,String(json[key])])
    } 
    return result
  }

  onRefreshClick() {
    this.api.dispatchPostRequest("/api/products", {}).then(
      res => {
        this.onAllProducts(res['products']);
      },
      msg => {
        this.error = JSON.stringify(msg)
      })
  }

  isEditModeEnabled = false

  onEditModeClick() {
    this.isEditModeEnabled = !this.isEditModeEnabled
  }

  onEditProductClick(p) {
    var id = p['id']
    this.router.navigate(['products/edit/' + id])
  }

  onDeleteProductClick(product) {
    var id = product['id']
    if (confirm("Should delete " + product['name'] + " ?")) {
      this.api.dispatchPostRequest("/api/products/delete/" + id, {}).then(
        res => {
          this.onRefreshClick()
        },
        msg => {
          this.error = JSON.stringify(msg)
        }
      )
    }
  }
  onAddProductImageClick(product) {
    const foreigh_key = product.id
    this.router.navigate(['files/add/', {foreignKey: product.id, isPublic: "true"}])
  }

  onAddNewProductClick() {
    this.router.navigate(['products/add-new-product'])
  }
}
